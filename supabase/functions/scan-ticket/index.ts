// Verifies a scanned ticket QR server-side and records a check-in.
// Roles: 'disciplinary' -> main_gate, 'event_oc' -> venue (locked to their competition), 'admin' -> both.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, verifyTicketToken } from "../_shared/qr.ts";

const DEBOUNCE_SECONDS = 6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const token: string = typeof body?.token === "string" ? body.token.trim() : "";
    const ticketCode: string = typeof body?.ticket_code === "string" ? body.ticket_code.trim().toUpperCase() : "";
    const mode: string = body?.mode === "venue" ? "venue" : body?.mode === "gate" ? "gate" : "";
    const deviceInfo: string | null = typeof body?.device_info === "string" ? body.device_info.slice(0, 200) : null;

    if (!mode) return json({ error: "Invalid request" }, 400);
    if (!token && !ticketCode) return json({ error: "Invalid request" }, 400);
    if (token && token.length > 512) return json({ error: "Invalid request" }, 400);
    if (ticketCode && !/^TF-[A-Z0-9]{4,16}$/.test(ticketCode)) return json({ error: "Invalid ticket code" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---- Role check (server-side, never trusts the client) ----
    const { data: roles } = await admin.from("user_roles").select("role, competition_id").eq("user_id", userId);
    const roleList = (roles ?? []) as { role: string; competition_id: string | null }[];
    const isAdmin = roleList.some((r) => r.role === "admin");
    const isDisciplinary = roleList.some((r) => r.role === "disciplinary");
    const ocRole = roleList.find((r) => r.role === "event_oc");

    if (mode === "gate" && !(isAdmin || isDisciplinary)) return json({ error: "Not authorised for the main gate" }, 403);
    if (mode === "venue" && !(isAdmin || ocRole)) return json({ error: "Not authorised for venue scanning" }, 403);

    // ---- Ticket lookup ----
    // Camera scans send the signed QR token (verified below); the manual fallback
    // uses the short human-readable ticket_code printed on the ticket/email instead,
    // since the raw signed token is never shown to the attendee — only encoded in
    // the QR image itself, so it was never something a person could type in.
    let reg;
    if (token) {
      if (!(await verifyTicketToken(token))) {
        return json({ result: "denied", reason: "Invalid or tampered QR code" });
      }
      const { data } = await admin
        .from("registrations")
        .select(`id, ticket_code, status, competition_id,
          participants ( name, email, organization ),
          competitions ( id, name, venue, max_venue_scans, events ( max_gate_scans ) )`)
        .eq("qr_secret_token", token)
        .maybeSingle();
      reg = data;
    } else {
      const { data } = await admin
        .from("registrations")
        .select(`id, ticket_code, status, competition_id,
          participants ( name, email, organization ),
          competitions ( id, name, venue, max_venue_scans, events ( max_gate_scans ) )`)
        .eq("ticket_code", ticketCode)
        .maybeSingle();
      reg = data;
    }

    if (!reg) return json({ result: "denied", reason: "Ticket not recognised" });
    if (reg.status !== "confirmed") return json({ result: "denied", reason: `Ticket is ${reg.status}` });

    const participant = reg.participants as unknown as { name: string; email: string; organization: string | null };
    const regCompetition = reg.competitions as unknown as { max_venue_scans: number; events: { max_gate_scans: number } | null } | null;
    const maxScans = mode === "gate" ? (regCompetition?.events?.max_gate_scans ?? 0) : (regCompetition?.max_venue_scans ?? 0);

    // All competitions this participant is registered for (shown at the gate)
    const { data: allRegs } = await admin
      .from("registrations")
      .select("competition_id, competitions(name, venue, start_time)")
      .eq("participant_id", (await admin.from("registrations").select("participant_id").eq("id", reg.id).single()).data!.participant_id);

    const competitions = (allRegs ?? []).map((r) => {
      const c = r.competitions as unknown as { name: string; venue: string | null; start_time: string | null } | null;
      return { name: c?.name ?? "Unknown", venue: c?.venue ?? null, start_time: c?.start_time ?? null };
    });

    let competitionId: string | null = null;
    if (mode === "venue") {
      competitionId = ocRole?.competition_id ?? (isAdmin ? (body?.competition_id ?? null) : null);
      if (!competitionId) return json({ error: "No competition assigned to this account" }, 403);
      if (reg.competition_id !== competitionId) {
        return json({
          result: "denied",
          reason: "Not registered for this competition",
          participant: { name: participant.name, ticket_code: reg.ticket_code },
        });
      }
    }

    // ---- Duplicate / debounce handling ----
    const since = new Date(Date.now() - DEBOUNCE_SECONDS * 1000).toISOString();
    let debounceQuery = admin
      .from("checkins")
      .select("id")
      .eq("registration_id", reg.id)
      .eq("checkin_type", mode === "gate" ? "main_gate" : "venue")
      .gte("scanned_at", since);
    if (competitionId) debounceQuery = debounceQuery.eq("competition_id", competitionId);
    const { data: recent } = await debounceQuery.limit(1);
    if (recent && recent.length > 0) {
      return json({
        result: "debounced",
        reason: "Just scanned - ignoring rapid re-scan",
        participant: { name: participant.name, ticket_code: reg.ticket_code, organization: participant.organization },
        competitions,
      });
    }

    let priorQuery = admin
      .from("checkins")
      .select("id, scanned_at")
      .eq("registration_id", reg.id)
      .eq("checkin_type", mode === "gate" ? "main_gate" : "venue")
      .order("scanned_at", { ascending: false });
    if (competitionId) priorQuery = priorQuery.eq("competition_id", competitionId);
    const { data: prior } = await priorQuery;
    const priorCount = prior?.length ?? 0;
    const isDuplicate = priorCount > 0;

    if (maxScans > 0 && priorCount >= maxScans) {
      return json({
        result: "denied",
        reason: `Scan limit reached (${priorCount}/${maxScans} used)`,
        participant: { name: participant.name, ticket_code: reg.ticket_code, organization: participant.organization },
        scan_count: priorCount,
        max_scans: maxScans,
        competitions,
      });
    }

    const { error: insErr } = await admin.from("checkins").insert({
      registration_id: reg.id,
      checkin_type: mode === "gate" ? "main_gate" : "venue",
      competition_id: competitionId,
      scanned_by: userId,
      device_info: deviceInfo,
      is_duplicate: isDuplicate,
    });
    if (insErr) {
      console.error("checkin insert failed", insErr);
      return json({ error: "Could not record check-in" }, 500);
    }

    return json({
      result: isDuplicate ? "duplicate" : "success",
      reason: isDuplicate ? `Already checked in at ${prior![0].scanned_at}` : null,
      participant: {
        name: participant.name,
        email: participant.email,
        organization: participant.organization,
        ticket_code: reg.ticket_code,
      },
      scan_count: priorCount + 1,
      max_scans: maxScans || null,
      competitions,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Unexpected error" }, 500);
  }
});
