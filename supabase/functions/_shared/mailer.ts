// Brevo (formerly Sendinblue) transactional email sender, over plain HTTPS.
//
// Why not Gmail SMTP: Supabase Edge Functions run on Deno Deploy, which does
// not reliably support raw outbound TCP/SMTP connections (port 465/587) —
// sends would hang or fail intermittently no matter how correct the App
// Password was. Brevo's API is called over HTTPS like any other fetch, so it
// works from Edge Functions every time.
//
// Why not Resend: Resend's free tier can only mail the account owner unless
// you verify a custom domain. The fest only has a plain Gmail address, no
// domain. Brevo's free tier lets you verify a single sender EMAIL ADDRESS
// (no DNS/domain needed) and then send to any recipient, up to 300
// emails/day for free — same shape of limit as Gmail's ~500/day, no SMTP.
//
// Required secrets (Project Settings -> Secrets):
//   BREVO_API_KEY      Create at https://app.brevo.com/settings/keys/api
//   BREVO_SENDER_EMAIL The address you verified under Senders & IP ->
//                      Senders in Brevo (e.g. helpdesk.luminus@gmail.com —
//                      your existing Gmail address works fine here, it just
//                      needs the one-click verification email Brevo sends)
//   BREVO_SENDER_NAME  Optional display name, e.g. "Luminus Events"
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

export class MailConfigError extends Error {}

interface MailCreds {
  apiKey: string;
  senderEmail: string;
  senderName?: string;
}

/** Reads and validates the Brevo secrets. Throws MailConfigError if missing. */
export function mailCredentials(): MailCreds {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || undefined;
  if (!apiKey || !senderEmail) {
    throw new MailConfigError(
      "Email sending isn't configured yet. Add BREVO_API_KEY and BREVO_SENDER_EMAIL (the address you verified as a sender in Brevo) in Project Settings -> Secrets.",
    );
  }
  return { apiKey, senderEmail, senderName };
}

// Kept for backwards compatibility with older imports; delegates to the
// current mailCredentials() check.
export function gmailCredentials(): MailCreds {
  return mailCredentials();
}

async function brevoSend(
  creds: MailCreds,
  msg: MailMessage,
  fromName?: string,
): Promise<void> {
  const res = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": creds.apiKey,
    },
    body: JSON.stringify({
      sender: { email: creds.senderEmail, name: fromName || creds.senderName || undefined },
      to: [{ email: msg.to }],
      replyTo: { email: creds.senderEmail },
      subject: msg.subject,
      htmlContent: msg.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo send failed (${res.status}): ${body || res.statusText}`);
  }
}

/** Send one email. Throws on failure. */
export async function sendMail(msg: MailMessage, fromName?: string): Promise<void> {
  const creds = mailCredentials();
  await brevoSend(creds, msg, fromName);
}

/**
 * Send several distinct emails (different subject/html per recipient).
 * Sent with a small concurrency limit — Brevo's API handles concurrent HTTPS
 * requests fine (unlike Gmail SMTP, which throttles simultaneous connections),
 * but we still cap it to stay well under rate limits on large batches.
 */
export async function sendMailBatch(
  items: { to: string; subject: string; html: string }[],
  fromName?: string,
): Promise<{ to: string; ok: boolean; error?: string }[]> {
  if (items.length === 0) return [];
  const creds = mailCredentials();
  const CONCURRENCY = 5;
  const results: { to: string; ok: boolean; error?: string }[] = new Array(items.length);

  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      try {
        await brevoSend(creds, item, fromName);
        results[i] = { to: item.to, ok: true };
      } catch (e) {
        console.error("Brevo batch send failed for", item.to, e);
        results[i] = { to: item.to, ok: false, error: String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

/**
 * Send the same email to many recipients. Each recipient gets their own
 * message (no shared To: header, no exposed recipient list).
 */
export async function sendBulkMail(
  recipients: string[],
  subject: string,
  html: string,
  fromName?: string,
): Promise<{ ok: number; failed: number; lastError?: string }> {
  if (recipients.length === 0) return { ok: 0, failed: 0 };
  const results = await sendMailBatch(
    recipients.map((to) => ({ to, subject, html })),
    fromName,
  );
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const lastError = results.find((r) => !r.ok)?.error;
  return { ok, failed, lastError };
}
