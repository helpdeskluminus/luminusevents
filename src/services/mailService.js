const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587 (STARTTLS)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

function buildQrEmail({ toName, toEmail, eventFestName, qrCidOrUrl, attachmentCid }) {
  const fromName = process.env.MAIL_FROM_NAME || 'Techfest';
  const fromAddress = process.env.MAIL_FROM_ADDRESS || 'no-reply@example.com';

  const html = `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; color: #1a1a1a;">
    <h2 style="margin-bottom: 4px;">${eventFestName}</h2>
    <p>Hi ${toName},</p>
    <p>You're registered. Your entry QR code is attached below — please save it or take a screenshot.
       Present it at the main gate for entry, and again at your competition venue.</p>
    <div style="text-align:center; margin: 24px 0;">
      <img src="cid:${attachmentCid}" alt="Your entry QR code" width="240" height="240" />
    </div>
    <p style="font-size: 13px; color: #555;">
      Keep this code private — it is uniquely tied to your registration. Do not forward or post it publicly.
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
    <p style="font-size: 12px; color: #999;">
      This is an automated message from ${eventFestName}. This mailbox is not monitored and
      replies are not read. For help, contact the event help desk on-site.
    </p>
  </div>`;

  return {
    from: `"${fromName}" <${fromAddress}>`,
    to: toEmail,
    subject: `Your entry pass — ${eventFestName}`,
    html,
    // No-reply enforcement: explicit headers signal mail clients not to route replies anywhere useful,
    // and there's no monitored inbox behind fromAddress in the first place.
    replyTo: undefined,
    headers: {
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
    },
  };
}

async function sendParticipantQrMail({ toName, toEmail, eventFestName, qrPngBuffer }) {
  const cid = 'entry-qr-code';
  const message = buildQrEmail({ toName, toEmail, eventFestName, attachmentCid: cid });

  message.attachments = [
    {
      filename: 'entry-qr.png',
      content: qrPngBuffer,
      cid,
      contentType: 'image/png',
    },
  ];

  return getTransporter().sendMail(message);
}

async function sendPasswordResetMail({ toName, toEmail, resetUrl, ttlMinutes }) {
  const fromName = process.env.MAIL_FROM_NAME || 'Techfest';
  const fromAddress = process.env.MAIL_FROM_ADDRESS || 'no-reply@example.com';

  const html = `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; color: #1a1a1a;">
    <h2 style="margin-bottom: 4px;">Reset your password</h2>
    <p>Hi ${toName},</p>
    <p>We received a request to reset the password for your ${fromName} organizer account.
       This link expires in ${ttlMinutes} minutes and can only be used once.</p>
    <div style="text-align:center; margin: 24px 0;">
      <a href="${resetUrl}" style="background:#4f7cff;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
        Reset password
      </a>
    </div>
    <p style="font-size: 13px; color: #555;">
      If you didn't request this, you can safely ignore this email — your password will not change.
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
    <p style="font-size: 12px; color: #999;">
      This is an automated message from ${fromName}. This mailbox is not monitored and
      replies are not read.
    </p>
  </div>`;

  return getTransporter().sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to: toEmail,
    subject: `Reset your password — ${fromName}`,
    html,
    headers: {
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
    },
  });
}

module.exports = { sendParticipantQrMail, sendPasswordResetMail };
