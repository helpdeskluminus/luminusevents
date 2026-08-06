import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, signTicketToken, generateTicketCode } from "../_shared/qr.ts";

interface Body {
  competition_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  organization?: string;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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

    // Fire the ticket email (non-blocking for the user's response quality)
    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-ticket-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ registration_id: registration.id }),
      });
      if (!res.ok) console.error("ticket email failed", res.status, await res.text());
    } catch (e) {
      console.error("ticket email error", e);
    }

    return json({ success: true, ticket_code: registration.ticket_code, competition: competition.name });
  } catch (e) {
    console.error(e);
    return json({ error: "Unexpected error" }, 500);
  }
});
