// Builds the ticket email (QR PNG + HTML) for a registration. Shared by
// send-ticket-email (the HTTP-callable single-ticket path) and
// bulk-register-participants (which sends many of these in-process via a
// small worker pool, rather than firing N unawaited HTTP calls that would
// each hit Brevo's API independently with no shared concurrency control -
// which could trip rate limits and silently drop tickets on bulk uploads).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.4";

function fmt(dt: string | null): string {
  if (!dt) return "TBA";
  return new Date(dt).toLocaleString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Not every registration is for a competition - some are webinars, workshops,
// or something else entirely. This only changes labelling/copy; the entry
// mechanism (QR at the main gate, then again at the session venue) is
// identical for every type, per how the fest actually runs.
type SessionType = "competition" | "webinar" | "workshop" | "other";

const TYPE_META: Record<SessionType, { label: string; hex: string; hexSecondary: string }> = {
  competition: { label: "Competition", hex: "#ec1cb4", hexSecondary: "#7c3aed" },
  webinar: { label: "Webinar", hex: "#0ea5e9", hexSecondary: "#6366f1" },
  workshop: { label: "Workshop", hex: "#f59e0b", hexSecondary: "#ec1cb4" },
  other: { label: "Session", hex: "#8b5cf6", hexSecondary: "#ec1cb4" },
};

function typeMeta(sessionType: string | null, typeLabel: string | null) {
  const key: SessionType = (["competition", "webinar", "workshop", "other"] as const).includes(sessionType as SessionType)
    ? (sessionType as SessionType)
    : "competition";
  const base = TYPE_META[key];
  const label = key === "other" ? (typeLabel?.trim() || "Session") : base.label;
  return { ...base, label };
}

export class RegistrationNotFoundError extends Error {}

export interface TicketEmailContent {
  registrationId: string;
  to: string;
  subject: string;
  html: string;
  qrUrl: string;
  eventName: string;
}

/** Fetches a registration, renders + stores its QR PNG, and builds the ticket email HTML. Does not send anything. */
export async function buildTicketEmailContent(admin: SupabaseClient, registrationId: string): Promise<TicketEmailContent> {
  const { data: reg, error } = await admin
    .from("registrations")
    .select(`id, ticket_code, qr_secret_token,
      participants ( name, email ),
      competitions ( name, venue, start_time, poster_url, session_type, type_label, events ( name, banner_url ) )`)
    .eq("id", registrationId)
    .maybeSingle();

  if (error || !reg) throw new RegistrationNotFoundError("Registration not found");

  const participant = reg.participants as unknown as { name: string; email: string };
  const competition = reg.competitions as unknown as {
    name: string; venue: string | null; start_time: string | null; poster_url: string | null;
    session_type: string | null; type_label: string | null;
    events: { name: string; banner_url: string | null } | null;
  };

  const dataUrl: string = await QRCode.toDataURL(reg.qr_secret_token, { width: 480, margin: 2 });
  const png = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
  const path = `tickets/${reg.ticket_code}.png`;
  const { error: upErr } = await admin.storage.from("event-images").upload(path, png, { contentType: "image/png", upsert: true });
  if (upErr) throw new Error(`Could not store QR image: ${upErr.message}`);
  const { data: pub } = admin.storage.from("event-images").getPublicUrl(path);
  const qrUrl = pub.publicUrl;

  const poster = competition.poster_url || competition.events?.banner_url || null;
  const eventName = competition.events?.name || "Techfest";
  const meta = typeMeta(competition.session_type, competition.type_label);
  const venueWord = meta.label.toLowerCase() === "session" ? "session" : meta.label.toLowerCase();

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Your ticket</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f0f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  Your entry ticket for ${esc(competition.name)} &mdash; QR inside, show it at the main gate. &#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f0f4;">
<tr><td align="center" style="padding:32px 16px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">

  <tr><td style="padding:0 4px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;letter-spacing:-0.3px;color:#18181b;">
        ${esc(eventName)}<span style="color:${meta.hex};">.</span>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 1px 3px rgba(24,24,27,0.06);">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

    <tr><td style="background-color:${meta.hex};background-image:linear-gradient(115deg,${meta.hex} 0%,${meta.hex} 45%,${meta.hexSecondary} 100%);padding:36px 32px 30px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background-color:rgba(255,255,255,0.18);border-radius:100px;padding:6px 14px;">
              <span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#ffffff;text-transform:uppercase;">${esc(meta.label)} &middot; Confirmed</span>
            </td>
          </tr></table>
          <p style="margin:18px 0 2px;font-size:12px;font-weight:600;letter-spacing:2px;color:rgba(255,255,255,0.85);text-transform:uppercase;">${esc(eventName)}</p>
          <h1 style="margin:0;font-size:28px;line-height:1.25;font-weight:800;color:#ffffff;font-family:Georgia,'Times New Roman',serif;">${esc(competition.name)}</h1>
        </td>
      </tr></table>
    </td></tr>

    ${poster ? `<tr><td>
      <img src="${esc(poster)}" width="600" alt="${esc(competition.name)}" style="width:100%;display:block;max-height:200px;object-fit:cover;" />
    </td></tr>` : ""}

    <tr><td style="padding:28px 32px 8px;">
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#52525b;">
        Hey <strong style="color:#18181b;">${esc(participant.name)}</strong> &mdash; you're all set. Here's your entry pass for the fest and this ${esc(venueWord)}.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="50%" style="padding:0 8px 12px 0;vertical-align:top;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf9fb;border-radius:14px;">
              <tr><td style="padding:14px 16px;">
                <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:1.5px;color:#a1a1aa;text-transform:uppercase;">Venue</p>
                <p style="margin:0;font-size:14px;font-weight:600;color:#18181b;">${esc(competition.venue || "TBA")}</p>
              </td></tr>
            </table>
          </td>
          <td width="50%" style="padding:0 0 12px 8px;vertical-align:top;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf9fb;border-radius:14px;">
              <tr><td style="padding:14px 16px;">
                <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:1.5px;color:#a1a1aa;text-transform:uppercase;">Date &amp; time</p>
                <p style="margin:0;font-size:14px;font-weight:600;color:#18181b;">${esc(fmt(competition.start_time))}</p>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>

    <tr><td style="padding:8px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="32" style="padding:0;"><div style="width:24px;height:24px;background-color:#f1f0f4;border-radius:100px;margin-left:20px;"></div></td>
        <td style="border-top:2px dashed #e4e4e7;font-size:0;line-height:0;">&nbsp;</td>
        <td width="32" style="padding:0;"><div style="width:24px;height:24px;background-color:#f1f0f4;border-radius:100px;margin-right:20px;"></div></td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:8px 32px 32px;" align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" style="background-color:#18181b;border-radius:20px;">
        <tr><td style="padding:24px;" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:14px;">
            <tr><td style="padding:12px;">
              <img src="${esc(qrUrl)}" width="200" height="200" alt="Entry QR code" style="display:block;" />
            </td></tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,0.5);text-transform:uppercase;">Ticket code</p>
          <p style="margin:2px 0 0;font-size:20px;font-weight:800;letter-spacing:3px;color:#ffffff;font-family:'Courier New',monospace;">${esc(reg.ticket_code)}</p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#71717a;max-width:420px;">
        Show this QR at the <strong style="color:#18181b;">main gate</strong> for fest entry, and again at the <strong style="color:#18181b;">${esc(venueWord)} entrance</strong>. Save it or take a screenshot &mdash; you'll need it even offline.
      </p>
    </td></tr>

  </table>
  </td></tr>

  <tr><td style="padding:16px 4px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3e2;border-radius:16px;">
      <tr><td style="padding:14px 18px;font-size:12.5px;line-height:1.6;color:#92610c;">
        <strong>This ticket is personal to you.</strong> It's tied to your registration and can't be transferred or reused by someone else.
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:24px 4px 4px;" align="center">
    <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.7;">
      This is an automated message from ${esc(eventName)} &mdash; please don't reply.<br/>
      Questions about your registration? Reach out to the event organisers.
    </p>
  </td></tr>

</table>

</td></tr>
</table>
</body></html>`;

  return {
    registrationId,
    to: participant.email,
    subject: `Your ${meta.label.toLowerCase()} ticket for ${competition.name} - ${eventName}`,
    html,
    qrUrl,
    eventName,
  };
}
