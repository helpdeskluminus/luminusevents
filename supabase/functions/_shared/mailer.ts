// Gmail SMTP sender.
//
// We deliberately do NOT use Resend / a hosted email API here: the fest only has
// a plain Gmail address (no custom domain), and domain-less Resend can only mail
// the account owner. Gmail SMTP needs no domain verification and delivers to any
// recipient, within Gmail's free ~500 recipients/day limit.
//
// Required secrets (Project Settings -> Secrets):
//   GMAIL_USER          e.g. helpdesk.luminus@gmail.com
//   GMAIL_APP_PASSWORD  16-character Google App Password (needs 2-Step Verification on)
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

export class MailConfigError extends Error {}

export function gmailCredentials(): { user: string; password: string } {
  const user = Deno.env.get("GMAIL_USER");
  const password = (Deno.env.get("GMAIL_APP_PASSWORD") || "").replace(/\s+/g, "");
  if (!user || !password) {
    throw new MailConfigError(
      "Gmail sending isn't configured yet. Add GMAIL_USER (the Gmail address) and GMAIL_APP_PASSWORD (16-character Google App Password) in Project Settings -> Secrets.",
    );
  }
  return { user, password };
}

async function withClient<T>(fn: (client: SMTPClient, from: string) => Promise<T>): Promise<T> {
  const { user, password } = gmailCredentials();
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: user, password },
    },
  });
  try {
    return await fn(client, user);
  } finally {
    try {
      await client.close();
    } catch (_) {
      // closing is best-effort; the send result is what matters
    }
  }
}

/** Send one email. Throws on SMTP failure. */
export async function sendMail(msg: MailMessage, fromName?: string): Promise<void> {
  await withClient(async (client, user) => {
    await client.send({
      from: fromName ? `${fromName} <${user}>` : user,
      to: msg.to,
      replyTo: user,
      subject: msg.subject,
      content: "auto",
      html: msg.html,
    });
  });
}

/**
 * Send several distinct emails (different subject/html per recipient) over a
 * single SMTP connection. Use this instead of calling sendMail() in a loop or
 * firing concurrent unawaited sends - Gmail throttles/rejects past a handful
 * of simultaneous connections, which silently drops mail on bulk sends.
 */
export async function sendMailBatch(
  items: { to: string; subject: string; html: string }[],
  fromName?: string,
): Promise<{ to: string; ok: boolean; error?: string }[]> {
  if (items.length === 0) return [];
  return await withClient(async (client, user) => {
    const results: { to: string; ok: boolean; error?: string }[] = [];
    for (const item of items) {
      try {
        await client.send({
          from: fromName ? `${fromName} <${user}>` : user,
          to: item.to,
          replyTo: user,
          subject: item.subject,
          content: "auto",
          html: item.html,
        });
        results.push({ to: item.to, ok: true });
      } catch (e) {
        console.error("SMTP batch send failed for", item.to, e);
        results.push({ to: item.to, ok: false, error: String(e) });
      }
    }
    return results;
  });
}

/**
 * Send the same email to many recipients over a single SMTP connection.
 * Each recipient gets their own message (no shared To: header).
 */
export async function sendBulkMail(
  recipients: string[],
  subject: string,
  html: string,
  fromName?: string,
): Promise<{ ok: number; failed: number; lastError?: string }> {
  if (recipients.length === 0) return { ok: 0, failed: 0 };
  return await withClient(async (client, user) => {
    let ok = 0, failed = 0, lastError: string | undefined;
    for (const to of recipients) {
      try {
        await client.send({
          from: fromName ? `${fromName} <${user}>` : user,
          to,
          replyTo: user,
          subject,
          content: "auto",
          html,
        });
        ok++;
      } catch (e) {
        failed++;
        lastError = String(e);
        console.error("SMTP send failed for", to, e);
      }
    }
    return { ok, failed, lastError };
  });
}
