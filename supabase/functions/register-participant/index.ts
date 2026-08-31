import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, signTicketToken, generateTicketCode, clientIp, hashIp } from "../_shared/qr.ts";
import { MailConfigError, sendMail } from "../_shared/mailer.ts";
import { buildTicketEmailContent } from "../_shared/ticketEmail.ts";

interface Body {
  competition_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  organization?: string;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// This is a public, unauthenticated endpoint (anyone with the competition link
// can hit it), so it needs its own abuse protection rather than relying on
// Supabase auth. Two windows: a tight one to stop rapid-fire bot submissions,
// a looser one to stop someone quietly registering hundreds of fake entries
// over a longer period from the same IP.
const RATE_LIMITS = [
  { windowSeconds: 60, max: 5 },
  { windowSeconds: 3600, max: 20 },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const ipHash = await hashIp(clientIp(req));
    const now = Date.now();
    const widestWindow = Math.max(...RATE_LIMITS.map((r) => r.windowSeconds));
    const { data: recentAttempts } = await admin
      .from("registration_attempts")
      .select("created_at")
      .eq("ip_hash", ipHash)
      .gte("created_at", new Date(now - widestWindow * 1000).toISOString());

    for (const limit of RATE_LIMITS) {
      const cutoff = now - limit.windowSeconds * 1000;
      const count = (recentAttempts ?? []).filter((a) => new Date((a as { created_at: string }).created_at).getTime() >= cutoff).length;
      if (count >= limit.max) {
        return json({ error: "Too many registration attempts from this connection. Please wait a bit and try again." }, 429);
      }
    }

    // Record this attempt before doing any work, so a flood of invalid
    // requests is throttled too, not just successful registrations.
    await admin.from("registration_attempts").insert({ ip_hash: ipHash });

    const body = (await req.json()) as Body;
    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const phone = (body.phone || "").trim();
    const organization = (body.organization || "").trim();
    const competitionId = (body.competition_id || "").trim();

    const errors: string[] = [];
    if (name.length < 2 || name.length > 120) errors.push("Name must be 2-120 characters");
    if (!isEmail(email) || email.length > 255) errors.push("A valid email is required");
    if (phone && phone.length > 30) errors.push("Phone is too long");
    if (organization.length > 160) errors.push("College/organisation is too long");
    if (!/^[0-9a-f-]{36}$/i.test(competitionId)) errors.push("A competition must be selected");
    if (errors.length) return json({ error: errors.join(". ") }, 400);

    const { data: competition } = await admin
      .from("competitions")
      .select("id, name, venue, start_time, poster_url, capacity, event_id, events(name, banner_url)")
      .eq("id", competitionId)
      .maybeSingle();
    if (!competition) return json({ error: "Competition not found" }, 404);

    if (competition.capacity) {
      const { count } = await admin
        .from("registrations")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId);
      if ((count ?? 0) >= competition.capacity) return json({ error: "This competition is full" }, 409);
    }

    // Upsert participant by email
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
      if (cErr || !created) return json({ error: "Could not create participant" }, 500);
      participantId = created.id;
    }

    const { data: dupe } = await admin
      .from("registrations")
      .select("id, ticket_code")
      .eq("participant_id", participantId)
      .eq("competition_id", competitionId)
      .maybeSingle();
    if (dupe) return json({ error: "You are already registered for this competition", ticket_code: dupe.ticket_code }, 409);

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
    if (rErr || !registration) {
      console.error("registration insert failed", rErr);
      return json({ error: "Could not create registration" }, 500);
    }

    // Send the ticket email in-process (not an HTTP call to our own
    // send-ticket-email function) - one fewer network hop and one fewer way
    // for this to fail independently of the actual send.
    let emailSent = false;
    let emailSkippedReason: string | null = null;
    try {
      const content = await buildTicketEmailContent(admin, registration.id);
      try {
        await sendMail({ to: content.to, subject: content.subject, html: content.html }, `${content.eventName} Tickets`);
        await admin.from("registrations").update({ email_sent_at: new Date().toISOString() }).eq("id", registration.id);
        emailSent = true;
      } catch (e) {
        if (e instanceof MailConfigError) {
          emailSkippedReason = e.message;
          console.warn("ticket email skipped - Brevo not configured");
        } else {
          console.error("ticket email send failed", e);
        }
      }
    } catch (e) {
      console.error("ticket email build failed", e);
    }

    return json({ success: true, ticket_code: registration.ticket_code, competition: competition.name, email_sent: emailSent, email_skipped_reason: emailSkippedReason });
  } catch (e) {
    console.error(e);
    return json({ error: "Unexpected error" }, 500);
  }
});
