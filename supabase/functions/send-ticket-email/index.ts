// Sends (or re-sends) the QR ticket email for a single registration over Gmail SMTP.
//
// Requires the `GMAIL_USER` and `GMAIL_APP_PASSWORD` secrets (Project Settings -> Secrets).
// No custom domain is needed — Gmail delivers to any recipient, ~500/day free.
//
// This is a thin HTTP wrapper: the actual content-building logic lives in
// _shared/ticketEmail.ts so bulk-register-participants can reuse it in-process
// (over one shared SMTP connection) instead of making N HTTP calls to this
// function, which would each open their own concurrent Gmail connection.
//
// Callable two ways:
//   - in-process from register-participant / bulk-register-participants right
//     after a registration is created (no auth header - trusted server call)
//   - over HTTP from the staff dashboard's "Resend ticket email" button, which
//     DOES require a valid staff session, checked below (admin/disciplinary,
//     or the event_oc who owns that competition).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/qr.ts";
import { MailConfigError, sendMail } from "../_shared/mailer.ts";
import { buildTicketEmailContent, RegistrationNotFoundError } from "../_shared/ticketEmail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { registration_id } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(registration_id ?? "")) return json({ error: "registration_id required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // A request carrying an Authorization header is a staff dashboard resend -
    // verify the caller is actually allowed to email this registration's
    // participant. A request with no header at all is the trusted in-process
    // call from register-participant/bulk-register-participants right after
    // creating the registration - nothing to authorise there.
    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(authHeader.replace("Bearer ", ""));
      if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
      const userId = claimsData.claims.sub as string;

      const { data: reg } = await admin.from("registrations").select("competition_id").eq("id", registration_id).maybeSingle();
      if (!reg) return json({ error: "Registration not found" }, 404);

      const { data: roles } = await admin.from("user_roles").select("role, competition_id").eq("user_id", userId);
      const roleList = (roles ?? []) as { role: string; competition_id: string | null }[];
      const authorised = roleList.some((r) =>
        r.role === "admin" || r.role === "disciplinary" || (r.role === "event_oc" && r.competition_id === reg.competition_id)
      );
      if (!authorised) return json({ error: "Not authorised to resend this ticket" }, 403);
    }

    let content;
    try {
      content = await buildTicketEmailContent(admin, registration_id);
    } catch (e) {
      if (e instanceof RegistrationNotFoundError) return json({ error: "Registration not found" }, 404);
      console.error("Could not build ticket email", e);
      return json({ error: "Could not prepare the ticket email", details: String(e) }, 500);
    }

    try {
      await sendMail({ to: content.to, subject: content.subject, html: content.html }, `${content.eventName} Tickets`);
    } catch (e) {
      if (e instanceof MailConfigError) {
        console.warn("Gmail SMTP not configured - ticket email skipped");
        return json({ success: false, skipped: true, reason: e.message, qr_url: content.qrUrl });
      }
      console.error("Gmail SMTP send failed", e);
      return json({ error: "Could not send the ticket email over Gmail SMTP", details: String(e), qr_url: content.qrUrl }, 502);
    }

    await admin.from("registrations").update({ email_sent_at: new Date().toISOString() }).eq("id", registration_id);
    return json({ success: true, qr_url: content.qrUrl });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
