const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { verifyParticipantToken } = require('../services/qrService');
const { logAction } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

const scanSchema = z.object({
  qr_token: z.string().min(10),
  device_id: z.string().max(100).optional(),
});

function logScan({ participantId, eventId, scanType, status, reason, deviceId, scannedBy }) {
  db.prepare(`
    INSERT INTO scan_logs (participant_id, event_id, scan_type, status, reason, device_id, scanned_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(participantId, eventId || null, scanType, status, reason || null, deviceId || null, scannedBy);
}

function resolveParticipantFromToken(qrToken) {
  const payload = verifyParticipantToken(qrToken); // throws if invalid/expired signature
  const participant = db.prepare('SELECT * FROM participants WHERE id = ? AND qr_jti = ?').get(payload.sub, payload.jti);
  return participant; // undefined if jti doesn't match current record (e.g. reissued or revoked-and-replaced)
}

// ---------- Main gate scan (admin only — fest-wide entry point) ----------
router.post('/main-gate', requireRole('admin'), (req, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });

  let participant;
  try {
    participant = resolveParticipantFromToken(parsed.data.qr_token);
  } catch (err) {
    return res.status(400).json({ result: 'denied', reason: 'Invalid or tampered QR code' });
  }

  if (!participant) return res.status(400).json({ result: 'denied', reason: 'Unrecognized QR code' });
  if (participant.qr_revoked) {
    logScan({ participantId: participant.id, scanType: 'main_gate', status: 'revoked', reason: 'QR revoked', deviceId: parsed.data.device_id, scannedBy: req.user.id });
    return res.status(403).json({ result: 'denied', reason: 'This QR code has been revoked' });
  }

  const already = db.prepare(`SELECT id FROM scan_logs WHERE participant_id = ? AND scan_type='main_gate' AND status='success'`).get(participant.id);
  if (already) {
    logScan({ participantId: participant.id, scanType: 'main_gate', status: 'duplicate', reason: 'Already checked in', deviceId: parsed.data.device_id, scannedBy: req.user.id });
    return res.status(200).json({ result: 'duplicate', name: participant.name, message: 'Already checked in at main gate' });
  }

  logScan({ participantId: participant.id, scanType: 'main_gate', status: 'success', deviceId: parsed.data.device_id, scannedBy: req.user.id });
  res.json({ result: 'success', name: participant.name, ticket_type: participant.ticket_type });
});

// ---------- Zone gate scan (event_oc scanning into their own competition; admin can also scan any) ----------
router.post('/zone-gate', requireRole('event_oc', 'admin'), (req, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });

  // The event being scanned into is always the OC's own event — never trusted from the request body.
  const eventId = req.user.role === 'event_oc' ? req.user.event_id : Number(req.body.event_id);
  if (!eventId) return res.status(400).json({ error: 'event_id required' });

  let participant;
  try {
    participant = resolveParticipantFromToken(parsed.data.qr_token);
  } catch (err) {
    return res.status(400).json({ result: 'denied', reason: 'Invalid or tampered QR code' });
  }
  if (!participant) return res.status(400).json({ result: 'denied', reason: 'Unrecognized QR code' });
  if (participant.qr_revoked) {
    logScan({ participantId: participant.id, eventId, scanType: 'zone_gate', status: 'revoked', reason: 'QR revoked', deviceId: parsed.data.device_id, scannedBy: req.user.id });
    return res.status(403).json({ result: 'denied', reason: 'This QR code has been revoked' });
  }

  // Must have arrived at the main gate first
  const mainGateOk = db.prepare(`SELECT id FROM scan_logs WHERE participant_id = ? AND scan_type='main_gate' AND status='success'`).get(participant.id);
  if (!mainGateOk) {
    logScan({ participantId: participant.id, eventId, scanType: 'zone_gate', status: 'denied', reason: 'Not checked in at main gate', deviceId: parsed.data.device_id, scannedBy: req.user.id });
    return res.status(403).json({ result: 'denied', reason: 'Participant has not checked in at the main gate yet' });
  }

  // Must be registered for this event
  const registered = db.prepare('SELECT id FROM registrations WHERE participant_id = ? AND event_id = ?').get(participant.id, eventId);
  if (!registered) {
    logScan({ participantId: participant.id, eventId, scanType: 'zone_gate', status: 'denied', reason: 'Not registered for this event', deviceId: parsed.data.device_id, scannedBy: req.user.id });
    return res.status(403).json({ result: 'denied', reason: 'Participant is not registered for this event' });
  }

  const already = db.prepare(`SELECT id FROM scan_logs WHERE participant_id = ? AND event_id = ? AND scan_type='zone_gate' AND status='success'`).get(participant.id, eventId);
  if (already) {
    logScan({ participantId: participant.id, eventId, scanType: 'zone_gate', status: 'duplicate', reason: 'Already checked in', deviceId: parsed.data.device_id, scannedBy: req.user.id });
    return res.status(200).json({ result: 'duplicate', name: participant.name, message: 'Already checked in at this event' });
  }

  // Capacity check
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (event && event.capacity) {
    const currentCount = db.prepare(`SELECT COUNT(DISTINCT participant_id) c FROM scan_logs WHERE event_id = ? AND scan_type='zone_gate' AND status='success'`).get(eventId).c;
    if (currentCount >= event.capacity) {
      logScan({ participantId: participant.id, eventId, scanType: 'zone_gate', status: 'denied', reason: 'Venue at capacity', deviceId: parsed.data.device_id, scannedBy: req.user.id });
      return res.status(403).json({ result: 'denied', reason: 'Venue is at capacity' });
    }
  }

  logScan({ participantId: participant.id, eventId, scanType: 'zone_gate', status: 'success', deviceId: parsed.data.device_id, scannedBy: req.user.id });
  res.json({ result: 'success', name: participant.name });
});

module.exports = router;
