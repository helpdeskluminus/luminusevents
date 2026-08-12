// Staff-only bulk roster upload: registers many participants for one
// competition in a single call, using the same participant-upsert +
// registration + ticket-email logic as the public register-participant flow.
// Authorised for admin (any competition) or event_oc (their own competition
// only, enforced server-side from their own user_roles row - never trusted
// from the request body).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, signTicketToken, generateTicketCode } from "../_shared/qr.ts";
import { MailConfigError, sendMailBatch } from "../_shared/mailer.ts";
import { buildTicketEmailContent } from "../_shared/ticketEmail.ts";

interface Row {
  name?: string;
  email?: string;
  phone?: string;
  organization?: string;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const MAX_ROWS = 500;

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
    const competitionId: string = typeof body?.competition_id === "string" ? body.competition_id.trim() : "";
    const rows: Row[] = Array.isArray(body?.rows) ? body.rows.slice(0, MAX_ROWS) : [];
    const sendEmails: boolean = body?.send_emails !== false;

    if (!/^[0-9a-f-]{36}$/i.test(competitionId)) return json({ error: "A competition must be selected" }, 400);
    if (rows.length === 0) return json({ error: "No rows to import" }, 400);
    if (Array.isArray(body?.rows) && body.rows.length > MAX_ROWS) {
      return json({ error: `Max ${MAX_ROWS} rows per upload - split larger rosters into batches` }, 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---- Authorisation ----
    const { data: roles } = await admin.from("user_roles").select("role, competition_id").eq("user_id", userId);
    const roleList = (roles ?? []) as { role: string; competition_id: string | null }[];
    const isAdmin = roleList.some((r) => r.role === "admin");
    const ocRole = roleList.find((r) => r.role === "event_oc");
    if (!isAdmin && !(ocRole && ocRole.competition_id === competitionId)) {
      return json({ error: "Not authorised to register participants for this competition" }, 403);
    }

    const { data: competition } = await admin
      .from("competitions")
      .select("id, name, capacity")
      .eq("id", competitionId)
      .maybeSingle();
    if (!competition) return json({ error: "Competition not found" }, 404);

    let existingCount = 0;
    if (competition.capacity) {
      const { count } = await admin
        .from("registrations")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId);
      existingCount = count ?? 0;
    }

    const emailsConfigured = !!Deno.env.get("GMAIL_USER") && !!Deno.env.get("GMAIL_APP_PASSWORD");
    const results: { row: number; email: string; status: "registered" | "duplicate" | "error"; message?: string; ticket_code?: string }[] = [];
    // Registered rows queue up here for a single batched SMTP send after the
    // loop, instead of each row firing its own unawaited HTTP call to
    // send-ticket-email - Gmail throttles/rejects past a handful of
    // concurrent SMTP connections, which was silently dropping tickets.
    const pendingEmails: { row: number; registrationId: string; email: string }[] = [];
    let registeredCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = (r.name || "").trim();
      const email = (r.email || "").trim().toLowerCase();
      const phone = (r.phone || "").trim();
      const organization = (r.organization || "").trim();

      if (name.length < 2 || name.length > 120) {
        results.push({ row: i + 1, email, status: "error", message: "Name must be 2-120 characters" });
        continue;
      }
      if (!isEmail(email) || email.length > 255) {
        results.push({ row: i + 1, email, status: "error", message: "Invalid email" });
        continue;
      }
      if (competition.capacity && existingCount + registeredCount >= competition.capacity) {
        results.push({ row: i + 1, email, status: "error", message: "Competition is full" });
        continue;
      }

      try {
        let participantId: string;
        const { data: existing } = await admin.from("participants").select("id").ilike("email", email).maybeSingle();
        if (existing) {
          participantId = existing.id;
          await admin.from("participants").update({ name, phone: phone || null, organization: organization || null }).eq("id", participantId);
        } else {
          const { data: created, error: cErr } = await admin
            .from("participants")
            .insert({ name, email, phone: phone || null, organization: organization || null })
            .select("id")
            .single();
          if (cErr || !created) throw new Error(cErr?.message ?? "Could not create participant");
          participantId = created.id;
        }

        const { data: dupe } = await admin
          .from("registrations")
          .select("id, ticket_code")
          .eq("participant_id", participantId)
          .eq("competition_id", competitionId)
          .maybeSingle();
        if (dupe) {
          results.push({ row: i + 1, email, status: "duplicate", message: "Already registered", ticket_code: dupe.ticket_code });
          continue;
        }

        const registrationId = crypto.randomUUID();
        const token = await signTicketToken(registrationId, competitionId);
        const ticketCode = generateTicketCode();

        const { data: registration, error: rErr } = await admin
          .from("registrations")
          .insert({
            id: registrationId,
            participant_id: participantId,
            competition_id: competitionId,
            ticket_code: ticketCode,
            qr_secret_token: token,
            status: "confirmed",
          })
          .select("id, ticket_code")
          .single();
        if (rErr || !registration) throw new Error(rErr?.message ?? "Could not create registration");

        registeredCount++;
        results.push({ row: i + 1, email, status: "registered", ticket_code: registration.ticket_code });

        if (sendEmails) {
          pendingEmails.push({ row: i + 1, registrationId: registration.id, email });
        }
      } catch (e) {
        results.push({ row: i + 1, email, status: "error", message: e instanceof Error ? e.message : "Unexpected error" });
      }
    }

    // ---- Send all queued ticket emails over one shared SMTP connection ----
    let emailsSent = 0, emailsFailed = 0;
    if (sendEmails && pendingEmails.length > 0) {
      if (!emailsConfigured) {
        for (const pending of pendingEmails) {
          const r = results.find((res) => res.row === pending.row);
          if (r) r.message = (r.message ? `${r.message}; ` : "") + "Registered, but email not sent - Gmail sending isn't configured yet";
        }
      } else {
        // Building QR PNGs/HTML can happen concurrently (no shared SMTP
        // connection needed for this part); only the actual send is serialised
        // over one connection.
        const built = await Promise.all(
          pendingEmails.map(async (pending) => {
            try {
              const content = await buildTicketEmailContent(admin, pending.registrationId);
              return { ...pending, content, buildError: null as string | null };
            } catch (e) {
              return { ...pending, content: null, buildError: e instanceof Error ? e.message : "Could not prepare email" };
            }
          }),
        );

        for (const b of built) {
          if (b.buildError) {
            emailsFailed++;
            const r = results.find((res) => res.row === b.row);
            if (r) r.message = (r.message ? `${r.message}; ` : "") + `Registered, but email failed: ${b.buildError}`;
          }
        }

        const sendable = built.filter((b): b is typeof b & { content: NonNullable<typeof b.content> } => b.content !== null);
        try {
          const sendResults = await sendMailBatch(
            sendable.map((b) => ({ to: b.content.to, subject: b.content.subject, html: b.content.html })),
            competition.name,
          );
          const sentRegistrationIds: string[] = [];
          sendResults.forEach((sr, idx) => {
            const b = sendable[idx];
            const r = results.find((res) => res.row === b.row);
            if (sr.ok) {
              emailsSent++;
              sentRegistrationIds.push(b.registrationId);
            } else {
              emailsFailed++;
              if (r) r.message = (r.message ? `${r.message}; ` : "") + `Registered, but email failed to send: ${sr.error ?? "unknown error"}`;
            }
          });
          if (sentRegistrationIds.length > 0) {
            await admin.from("registrations").update({ email_sent_at: new Date().toISOString() }).in("id", sentRegistrationIds);
          }
        } catch (e) {
          emailsFailed += sendable.length;
          const reason = e instanceof MailConfigError ? e.message : String(e);
          for (const b of sendable) {
            const r = results.find((res) => res.row === b.row);
            if (r) r.message = (r.message ? `${r.message}; ` : "") + `Registered, but email failed to send: ${reason}`;
          }
        }
      }
    }

    return json({
      success: true,
      competition: competition.name,
      total: rows.length,
      emails_configured: emailsConfigured,
      emails_requested: sendEmails,
      emails_sent: emailsSent,
      emails_failed: emailsFailed,
      registered: registeredCount,
      duplicates: results.filter((r) => r.status === "duplicate").length,
      failed: results.filter((r) => r.status === "error").length,
      results,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Unexpected error" }, 500);
  }
});
