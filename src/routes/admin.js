const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { z } = require('zod');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { hashPassword } = require('../services/authService');
const { newJti, signParticipantToken, generateQrPngBuffer } = require('../services/qrService');
const { sendParticipantQrMail } = require('../services/mailService');
const { logAction } = require('../utils/audit');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.use(requireAuth, requireRole('admin'));

// ---------- Create event ----------
const eventSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  venue: z.string().max(200).optional(),
  capacity: z.number().int().positive().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
});

router.post('/events', (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, description, venue, capacity, start_time, end_time } = parsed.data;

  const result = db.prepare(`
    INSERT INTO events (name, description, venue, capacity, start_time, end_time, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, description || null, venue || null, capacity || null, start_time || null, end_time || null, req.user.id);

  logAction(req.user.id, 'event_created', { eventId: result.lastInsertRowid, name }, req);
  res.status(201).json({ id: result.lastInsertRowid, name });
});

router.get('/events', (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY created_at DESC').all();
  res.json(events);
});

// ---------- Create OC / Disciplinary accounts ----------
const accountSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  role: z.enum(['event_oc', 'disciplinary']),
  event_id: z.number().int().positive().optional(), // required if role === event_oc
});

router.post('/accounts', async (req, res) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, email, password, role, event_id } = parsed.data;

  if (role === 'event_oc' && !event_id) {
    return res.status(400).json({ error: 'event_id is required when creating an event_oc account' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const password_hash = await hashPassword(password);
  const result = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, event_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, email.toLowerCase(), password_hash, role, role === 'event_oc' ? event_id : null);

  if (role === 'event_oc') {
    db.prepare('UPDATE events SET oc_user_id = ? WHERE id = ?').run(result.lastInsertRowid, event_id);
  }

  logAction(req.user.id, 'account_created', { userId: result.lastInsertRowid, role, email }, req);
  res.status(201).json({ id: result.lastInsertRowid, name, email, role });
});

router.get('/accounts', (req, res) => {
  const accounts = db.prepare('SELECT id, name, email, role, event_id, is_active, created_at FROM users ORDER BY created_at DESC').all();
  res.json(accounts);
});

// ---------- Bulk participant upload (CSV: name,email,phone,ticket_type,events) ----------
// "events" column is a semicolon-separated list of event names to register the participant for.
router.post('/participants/bulk-upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file required (field name: file)' });

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse CSV: ' + err.message });
  }

  const eventsByName = new Map(
    db.prepare('SELECT id, name FROM events').all().map(e => [e.name.toLowerCase(), e.id])
  );

  const insertParticipant = db.prepare(`
    INSERT INTO participants (name, email, phone, ticket_type, qr_jti, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertRegistration = db.prepare(`
    INSERT OR IGNORE INTO registrations (participant_id, event_id) VALUES (?, ?)
  `);
  const findByEmail = db.prepare('SELECT id, qr_jti FROM participants WHERE email = ?');

  const results = { created: 0, skipped: 0, errors: [] };

  const runAll = db.transaction((rows) => {
    for (const row of rows) {
      const { name, email, phone, ticket_type, events: eventsCol } = row;
      if (!name || !email) {
        results.errors.push({ row, error: 'Missing name or email' });
        continue;
      }
      const emailLower = email.toLowerCase().trim();
      let participant = findByEmail.get(emailLower);

      if (!participant) {
        const jti = newJti();
        const info = insertParticipant.run(name.trim(), emailLower, phone || null, ticket_type || 'general', jti, req.user.id);
        participant = { id: info.lastInsertRowid, qr_jti: jti };
        results.created++;
      } else {
        results.skipped++;
      }

      if (eventsCol) {
        const names = eventsCol.split(';').map(s => s.trim().toLowerCase()).filter(Boolean);
        for (const n of names) {
          const eventId = eventsByName.get(n);
          if (eventId) insertRegistration.run(participant.id, eventId);
          else results.errors.push({ row, error: `Unknown event: ${n}` });
        }
      }
    }
  });

  runAll(records);
  logAction(req.user.id, 'participants_bulk_uploaded', results, req);
  res.json(results);
});

// ---------- Send (or resend) the QR entry mail ----------
router.post('/participants/:id/send-qr-mail', async (req, res) => {
  const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(req.params.id);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });
  if (participant.qr_revoked) return res.status(409).json({ error: 'This participant\'s QR has been revoked' });

  try {
    const token = signParticipantToken(participant.id, participant.qr_jti);
    const pngBuffer = await generateQrPngBuffer(token);

    await sendParticipantQrMail({
      toName: participant.name,
      toEmail: participant.email,
      eventFestName: process.env.MAIL_FROM_NAME || 'Techfest',
      qrPngBuffer: pngBuffer,
    });

    db.prepare('UPDATE participants SET mail_sent = 1, mail_sent_at = datetime(\'now\') WHERE id = ?').run(participant.id);
    logAction(req.user.id, 'qr_mail_sent', { participantId: participant.id }, req);
    res.json({ status: 'sent' });
  } catch (err) {
    console.error('Mail send failed:', err);
    res.status(502).json({ error: 'Failed to send mail. Check SMTP configuration.' });
  }
});

// Bulk-send to everyone who hasn't received their mail yet
router.post('/participants/send-all-pending', async (req, res) => {
  const pending = db.prepare('SELECT * FROM participants WHERE mail_sent = 0 AND qr_revoked = 0').all();
  let sent = 0;
  const failures = [];

  for (const participant of pending) {
    try {
      const token = signParticipantToken(participant.id, participant.qr_jti);
      const pngBuffer = await generateQrPngBuffer(token);
      await sendParticipantQrMail({
        toName: participant.name,
        toEmail: participant.email,
        eventFestName: process.env.MAIL_FROM_NAME || 'Techfest',
        qrPngBuffer: pngBuffer,
      });
      db.prepare('UPDATE participants SET mail_sent = 1, mail_sent_at = datetime(\'now\') WHERE id = ?').run(participant.id);
      sent++;
    } catch (err) {
      failures.push({ participantId: participant.id, error: err.message });
    }
  }

  logAction(req.user.id, 'qr_mail_bulk_sent', { sent, failed: failures.length }, req);
  res.json({ sent, failed: failures.length, failures });
});

// ---------- Revoke a participant's QR (lost badge, fraud, etc.) ----------
router.post('/participants/:id/revoke', (req, res) => {
  const info = db.prepare('UPDATE participants SET qr_revoked = 1 WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Participant not found' });
  logAction(req.user.id, 'qr_revoked', { participantId: req.params.id }, req);
  res.json({ status: 'revoked' });
});

// ---------- Global live dashboard ----------
router.get('/dashboard', (req, res) => {
  const totalParticipants = db.prepare('SELECT COUNT(*) c FROM participants').get().c;
  const mainGateCheckins = db.prepare(`SELECT COUNT(DISTINCT participant_id) c FROM scan_logs WHERE scan_type='main_gate' AND status='success'`).get().c;

  const perEvent = db.prepare(`
    SELECT e.id, e.name, e.capacity,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered,
      (SELECT COUNT(DISTINCT sl.participant_id) FROM scan_logs sl WHERE sl.event_id = e.id AND sl.scan_type='zone_gate' AND sl.status='success') AS checked_in
    FROM events e ORDER BY e.name
  `).all();

  res.json({ totalParticipants, mainGateCheckins, events: perEvent });
});

module.exports = router;
