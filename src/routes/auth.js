const express = require('express');
const { z } = require('zod');
const crypto = require('crypto');
const db = require('../db');
const { verifyPassword, issueSessionToken, hashPassword } = require('../services/authService');
const { generateRawToken, hashToken, expiryTimestamp, RESET_TOKEN_TTL_MINUTES } = require('../services/resetTokenService');
const { sendPasswordResetMail } = require('../services/mailService');
const { logAction } = require('../utils/audit');

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email or password format' });
  const { email, password } = parsed.data;

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

  // Constant-shape response whether or not the user exists, to avoid user-enumeration timing/behavior differences.
  const genericFail = () => res.status(401).json({ error: 'Invalid credentials' });

  if (!user || !user.is_active) {
    logAction(null, 'login_failed', { email, reason: 'no_such_user_or_inactive' }, req);
    return genericFail();
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    logAction(user.id, 'login_blocked_locked', {}, req);
    return res.status(423).json({ error: `Account temporarily locked. Try again after ${user.locked_until}.` });
  }

  const ok = await verifyPassword(password, user.password_hash);

  if (!ok) {
    const failedCount = user.failed_login_count + 1;
    let lockedUntil = null;
    if (failedCount >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
    }
    db.prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?')
      .run(failedCount, lockedUntil, user.id);
    logAction(user.id, 'login_failed', { failedCount }, req);
    return genericFail();
  }

  // Success: reset failure counter
  db.prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?').run(user.id);

  const token = issueSessionToken(user);
  logAction(user.id, 'login_success', {}, req);

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, event_id: user.event_id },
  });
});

// ---------- Forgot password ----------
const forgotSchema = z.object({ email: z.string().email() });

router.post('/forgot-password', async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email' });
  const email = parsed.data.email.toLowerCase();

  // Always return the same generic response whether or not the account exists —
  // otherwise this endpoint becomes a free tool to check who has an account.
  const genericResponse = () => res.json({ message: 'If that account exists, a reset link has been sent.' });

  const user = db.prepare('SELECT id, name, email, is_active FROM users WHERE email = ?').get(email);
  if (!user || !user.is_active) {
    logAction(null, 'password_reset_requested_unknown', { email }, req);
    return genericResponse();
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);

  db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`)
    .run(user.id, tokenHash, expiryTimestamp());

  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const resetUrl = `${baseUrl}/reset-password.html?token=${rawToken}`;

  try {
    await sendPasswordResetMail({ toName: user.name, toEmail: user.email, resetUrl, ttlMinutes: RESET_TOKEN_TTL_MINUTES });
  } catch (err) {
    // Don't leak SMTP failures to the client — that would also confirm account existence indirectly.
    console.error('Password reset mail failed:', err.message);
  }

  logAction(user.id, 'password_reset_requested', {}, req);
  return genericResponse();
});

// ---------- Reset password ----------
const resetSchema = z.object({
  token: z.string().min(20),
  new_password: z.string().min(10, 'Password must be at least 10 characters'),
});

router.post('/reset-password', async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { token, new_password } = parsed.data;

  const tokenHash = hashToken(token);
  const record = db.prepare(`SELECT * FROM password_resets WHERE token_hash = ?`).get(tokenHash);

  // Timing-safe-ish generic failure: same message whether token is missing, expired, or already used.
  const invalid = () => res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });

  if (!record) return invalid();
  if (record.used) return invalid();
  if (new Date(record.expires_at) < new Date()) return invalid();

  const password_hash = await hashPassword(new_password);

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?')
      .run(password_hash, record.user_id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(record.id);
    // Invalidate any other outstanding reset tokens for this user
    db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND id != ?').run(record.user_id, record.id);
  });
  tx();

  logAction(record.user_id, 'password_reset_completed', {}, req);
  res.json({ message: 'Password updated. You can now log in with your new password.' });
});

module.exports = router;
