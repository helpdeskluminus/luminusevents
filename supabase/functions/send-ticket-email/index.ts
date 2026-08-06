// Sends the QR ticket email for a registration.
//
// TODO: Add the `RESEND_API_KEY` secret in Project Settings -> Secrets before this
// function can deliver mail. Also add `FROM_EMAIL` (e.g. "Techfest <no-reply@yourdomain.com>")
// using a domain that is verified in Resend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.4";
import { corsHeaders, json } from "../_shared/qr.ts";

const FALLBACK_FROM = "Techfest Tickets <onboarding@resend.dev>";

function fmt(dt: string | null): string {
  if (!dt) return "TBA";
  return new Date(dt).toLocaleString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { registration_id } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(registration_id ?? "")) return json({ error: "registration_id required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: reg, error } = await admin
      .from("registrations")
      .select(`id, ticket_code, qr_secret_token,
        participants ( name, email ),
        competitions ( name, venue, start_time, poster_url, events ( name, banner_url ) )`)
      .eq("id", registration_id)
      .maybeSingle();

    if (error || !reg) return json({ error: "Registration not found" }, 404);

    const participant = reg.participants as unknown as { name: string; email: string };
    const competition = reg.competitions as unknown as {
      name: string; venue: string | null; start_time: string | null; poster_url: string | null;
      events: { name: string; banner_url: string | null } | null;
    };

    // Render the signed token to a PNG and host it publicly so email clients can load it.
    const dataUrl: string = await QRCode.toDataURL(reg.qr_secret_token, { width: 480, margin: 2 });
    const png = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
    const path = `tickets/${reg.ticket_code}.png`;
    await admin.storage.from("event-images").upload(path, png, { contentType: "image/png", upsert: true });
    const { data: pub } = admin.storage.from("event-images").getPublicUrl(path);
    const qrUrl = pub.publicUrl;

    const poster = competition.poster_url || competition.events?.banner_url || null;
    const eventName = competition.events?.name || "Techfest";

    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Helvetica,Arial,sans-serif;color:#0a0a0a;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border:1px solid #e5e5e5;border-radius:16px;overflow:hidden;">
      ${poster ? `<img src="${esc(poster)}" alt="${esc(competition.name)}" width="560" style="width:100%;display:block;object-fit:cover;max-height:240px;" />` : ""}
      <div style="padding:24px;">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#ff29c3;font-weight:700;">${esc(eventName)}</p>
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;">${esc(competition.name)}</h1>

        <table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 0;color:#737373;width:110px;">Attendee</td><td style="padding:6px 0;font-weight:600;">${esc(participant.name)}</td></tr>
          <tr><td style="padding:6px 0;color:#737373;">Venue</td><td style="padding:6px 0;font-weight:600;">${esc(competition.venue || "TBA")}</td></tr>
          <tr><td style="padding:6px 0;color:#737373;">Date &amp; time</td><td style="padding:6px 0;font-weight:600;">${esc(fmt(competition.start_time))}</td></tr>
          <tr><td style="padding:6px 0;color:#737373;">Ticket code</td><td style="padding:6px 0;font-weight:700;letter-spacing:1px;">${esc(reg.ticket_code)}</td></tr>
        </table>

        <div style="margin:24px 0 8px;border-top:1px dashed #d4d4d4;padding-top:24px;text-align:center;">
          <img src="${esc(qrUrl)}" width="220" height="220" alt="Entry QR code" style="display:block;margin:0 auto;border-radius:12px;" />
          <p style="margin:14px 0 0;font-size:13px;color:#525252;line-height:1.6;">
            Show this QR at the <strong>main gate</strong> for fest entry, and again at the
            <strong>competition venue</strong> entrance. Keep it handy on your phone or print it.
          </p>
        </div>
      </div>
    </div>
    <p style="text-align:center;font-size:11px;color:#a3a3a3;margin:16px 0 0;">
      This is an automated no-reply message. Do not share this ticket &mdash; the QR is unique to you.
    </p>
  </div>
</body></html>`;

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      console.warn("RESEND_API_KEY not configured - ticket email skipped");
      return json({ success: false, skipped: true, reason: "RESEND_API_KEY not configured", qr_url: qrUrl });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: Deno.env.get("FROM_EMAIL") || FALLBACK_FROM,
        to: [participant.email],
        subject: `Your ticket for ${competition.name} - ${eventName}`,
        html,
      }),
    });

    if (!res.ok) {
      const details = await res.text();
      console.error("Resend failed", res.status, details);
      return json({ error: "Email provider rejected the request", status: res.status, details }, res.status);
    }

    await admin.from("registrations").update({ email_sent_at: new Date().toISOString() }).eq("id", reg.id);
    return json({ success: true, qr_url: qrUrl });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
