// Admin-only: send an arbitrary, admin-authored email (instructions, updates, etc.)
// to a chosen audience, from the fest's Gmail address over SMTP.
// Every send is logged to public.email_broadcasts for audit purposes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MailConfigError, gmailCredentials, sendBulkMail } from "../_shared/mailer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");


function renderHtml(subject: string, bodyText: string, eventName: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<tr><td style="padding:0 0 14px;"><p style="margin:0;font-size:15px;line-height:1.7;color:#52525b;">${esc(p).replace(/\n/g, "<br/>")}</p></td></tr>`,
    )
    .join("");

  const preheader = bodyText.replace(/\s+/g, " ").slice(0, 120);

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f0f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  ${esc(preheader)} &#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f0f4;">
<tr><td align="center" style="padding:32px 16px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">

  <tr><td style="padding:0 4px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;letter-spacing:-0.3px;color:#18181b;">
        ${esc(eventName)}<span style="color:#ec1cb4;">.</span>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 1px 3px rgba(24,24,27,0.06);">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

    <tr><td style="background-color:#ec1cb4;background-image:linear-gradient(115deg,#ec1cb4 0%,#ec1cb4 45%,#7c3aed 100%);padding:36px 32px 30px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background-color:rgba(255,255,255,0.18);border-radius:100px;padding:6px 14px;">
          <span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#ffffff;text-transform:uppercase;">Announcement</span>
        </td>
      </tr></table>
      <p style="margin:18px 0 2px;font-size:12px;font-weight:600;letter-spacing:2px;color:rgba(255,255,255,0.85);text-transform:uppercase;">${esc(eventName)}</p>
      <h1 style="margin:0;font-size:28px;line-height:1.25;font-weight:800;color:#ffffff;font-family:Georgia,'Times New Roman',serif;">${esc(subject)}</h1>
    </td></tr>

    <tr><td style="padding:28px 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf9fb;border-radius:16px;">
        <tr><td style="padding:20px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${paragraphs}
          </table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:16px 0 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="32" style="padding:0;"><div style="width:24px;height:24px;background-color:#f1f0f4;border-radius:100px;margin-left:20px;"></div></td>
        <td style="border-top:2px dashed #e4e4e7;font-size:0;line-height:0;">&nbsp;</td>
        <td width="32" style="padding:0;"><div style="width:24px;height:24px;background-color:#f1f0f4;border-radius:100px;margin-right:20px;"></div></td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:8px 32px 30px;" align="center">
      <p style="margin:0;font-size:12.5px;line-height:1.6;color:#a1a1aa;">
        Sent to you because you're registered with ${esc(eventName)}.
      </p>
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
}




Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claimsData.claims.sub as string;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: callerId, _role: "admin" });
    if (!isAdmin) return json({ error: "Admins only" }, 403);

    const body = await req.json();
    const subject: string = String(body?.subject ?? "").trim().slice(0, 200);
    const message: string = String(body?.body ?? "").trim().slice(0, 20000);
    const audienceType: string = body?.audience_type ?? "";
    const competitionId: string | null = body?.competition_id ?? null;
    const customEmails: string[] = Array.isArray(body?.emails) ? body.emails : [];

    if (!subject) return json({ error: "Subject is required" }, 400);
    if (!message) return json({ error: "Message body is required" }, 400);
    if (!["all_participants", "competition_participants", "all_staff", "custom"].includes(audienceType)) {
      return json({ error: "Invalid audience" }, 400);
    }
    if (audienceType === "competition_participants" && !/^[0-9a-f-]{36}$/i.test(competitionId ?? "")) {
      return json({ error: "Pick a competition" }, 400);
    }

    let emails: string[] = [];

    if (audienceType === "all_participants") {
      const { data } = await admin.from("participants").select("email");
      emails = (data ?? []).map((p) => p.email);
    } else if (audienceType === "competition_participants") {
      const { data } = await admin
        .from("registrations")
        .select("participants(email)")
        .eq("competition_id", competitionId)
        .eq("status", "confirmed");
      emails = (data ?? []).map((r) => (r.participants as unknown as { email: string } | null)?.email).filter((e): e is string => !!e);
    } else if (audienceType === "all_staff") {
      const { data } = await admin.from("user_roles").select("profiles(email)");
      emails = (data ?? []).map((r) => (r.profiles as unknown as { email: string } | null)?.email).filter((e): e is string => !!e);
    } else {
      emails = customEmails.map((e) => String(e).trim().toLowerCase()).filter(isEmail);
    }

    // De-duplicate.
    emails = Array.from(new Set(emails));

    if (emails.length === 0) return json({ error: "No recipients matched this audience" }, 400);
    // Gmail's free sending cap is ~500 recipients/day, so a single broadcast can't exceed it.
    if (emails.length > 500) {
      return json({ error: `This audience has ${emails.length} recipients — Gmail allows about 500 emails per day. Narrow the audience down.` }, 400);
    }

    try {
      gmailCredentials();
    } catch (e) {
      const reason = e instanceof MailConfigError ? e.message : String(e);
      await admin.from("email_broadcasts").insert({
        subject, body: message, audience_type: audienceType, competition_id: audienceType === "competition_participants" ? competitionId : null,
        recipient_count: 0, failed_count: emails.length, sent_by: callerId, status: "failed", error: reason,
      });
      return json({ error: reason }, 400);
    }

    // Header event name: join through the competition when the audience is
    // competition-scoped, otherwise fall back to the most recent event.
    let eventName = "Techfest";
    if (audienceType === "competition_participants" && competitionId) {
      const { data: comp } = await admin
        .from("competitions")
        .select("events ( name )")
        .eq("id", competitionId)
        .maybeSingle();
      eventName = (comp?.events as unknown as { name: string } | null)?.name || eventName;
    } else {
      const { data: ev } = await admin
        .from("events")
        .select("name")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      eventName = ev?.name || eventName;
    }

    const html = renderHtml(subject, message, eventName);

    // One SMTP connection, one message per recipient (no shared To: header).
    const { ok, failed, lastError } = await sendBulkMail(emails, subject, html, eventName);


    const status = failed === 0 ? "sent" : ok === 0 ? "failed" : "partial";

    await admin.from("email_broadcasts").insert({
      subject, body: message, audience_type: audienceType, competition_id: audienceType === "competition_participants" ? competitionId : null,
      recipient_count: ok, failed_count: failed, sent_by: callerId, status,
      error: failed > 0 ? `${failed} of ${emails.length} failed to send` : null,
    });

    return json({ success: status !== "failed", sent: ok, failed, total: emails.length });
  } catch (e) {
    console.error(e);
    return json({ error: "Unexpected error" }, 500);
  }
});
