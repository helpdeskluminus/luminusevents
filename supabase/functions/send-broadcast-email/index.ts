// Admin-only: send an arbitrary, admin-authored email (instructions, updates, etc.)
// to a chosen audience, from the same no-reply address as ticket emails.
// Every send is logged to public.email_broadcasts for audit purposes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const FALLBACK_FROM = "Techfest <onboarding@resend.dev>";
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderHtml(subject: string, bodyText: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#262626;">${esc(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Helvetica,Arial,sans-serif;color:#0a0a0a;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border:1px solid #e5e5e5;border-radius:16px;overflow:hidden;padding:28px 24px;">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#ff29c3;font-weight:700;">ANNOUNCEMENT</p>
      <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:700;">${esc(subject)}</h1>
      ${paragraphs}
    </div>
    <p style="text-align:center;font-size:11px;color:#a3a3a3;margin:16px 0 0;">
      This is an automated no-reply message from the fest organising team.
    </p>
  </div>
</body></html>`;
}

async function sendBatch(apiKey: string, from: string, subject: string, html: string, emails: string[]): Promise<{ ok: number; failed: number }> {
  if (emails.length === 0) return { ok: 0, failed: 0 };
  const payload = emails.map((to) => ({ from, to: [to], subject, html }));
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("Resend batch failed", res.status, await res.text());
    return { ok: 0, failed: emails.length };
  }
  return { ok: emails.length, failed: 0 };
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
    if (emails.length > 5000) return json({ error: "Audience too large for a single broadcast (max 5000) — narrow it down" }, 400);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("FROM_EMAIL") || FALLBACK_FROM;

    if (!apiKey) {
      await admin.from("email_broadcasts").insert({
        subject, body: message, audience_type: audienceType, competition_id: audienceType === "competition_participants" ? competitionId : null,
        recipient_count: emails.length, failed_count: emails.length, sent_by: callerId, status: "failed", error: "RESEND_API_KEY not configured",
      });
      return json({ error: "RESEND_API_KEY not configured — nothing was sent" }, 400);
    }

    const html = renderHtml(subject, message);

    // Resend's batch endpoint accepts up to 100 messages per call.
    let ok = 0, failed = 0;
    for (let i = 0; i < emails.length; i += 100) {
      const chunk = emails.slice(i, i + 100);
      const result = await sendBatch(apiKey, from, subject, html, chunk);
      ok += result.ok;
      failed += result.failed;
    }

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
