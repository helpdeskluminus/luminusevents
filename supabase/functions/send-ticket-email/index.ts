// Sends the QR ticket email for a single registration over Gmail SMTP.
//
// Requires the `GMAIL_USER` and `GMAIL_APP_PASSWORD` secrets (Project Settings -> Secrets).
// No custom domain is needed — Gmail delivers to any recipient, ~500/day free.
//
// This is a thin HTTP wrapper: the actual content-building logic lives in
// _shared/ticketEmail.ts so bulk-register-participants can reuse it in-process
// (over one shared SMTP connection) instead of making N HTTP calls to this
// function, which would each open their own concurrent Gmail connection.
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
