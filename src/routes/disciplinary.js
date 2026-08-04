const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth, requireRole('disciplinary', 'admin'));

// Cross-event live view: everyone currently checked in anywhere, which zone, any denials/duplicates flagged
router.get('/overview', (req, res) => {
  const events = db.prepare(`
    SELECT e.id, e.name, e.capacity,
      (SELECT COUNT(DISTINCT participant_id) FROM scan_logs sl WHERE sl.event_id = e.id AND sl.scan_type='zone_gate' AND sl.status='success') AS checked_in
    FROM events e ORDER BY e.name
  `).all();

  const recentDenials = db.prepare(`
    SELECT sl.id, p.name, p.email, sl.scan_type, sl.status, sl.reason, sl.timestamp, e.name AS event_name
    FROM scan_logs sl
    JOIN participants p ON p.id = sl.participant_id
    LEFT JOIN events e ON e.id = sl.event_id
    WHERE sl.status IN ('denied', 'duplicate', 'revoked')
    ORDER BY sl.timestamp DESC
    LIMIT 100
  `).all();

  res.json({ events, recentDenials });
});

// Search a participant's full activity across every gate/zone
router.get('/participant/:id/history', (req, res) => {
  const participant = db.prepare('SELECT id, name, email, qr_revoked FROM participants WHERE id = ?').get(req.params.id);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });

  const history = db.prepare(`
    SELECT sl.*, e.name AS event_name
    FROM scan_logs sl
    LEFT JOIN events e ON e.id = sl.event_id
    WHERE sl.participant_id = ?
    ORDER BY sl.timestamp DESC
  `).all(participant.id);

  const incidents = db.prepare('SELECT * FROM incidents WHERE participant_id = ? ORDER BY created_at DESC').all(participant.id);

  res.json({ participant, history, incidents });
});

// File an incident report
const incidentSchema = z.object({
  participant_id: z.number().int().positive().optional(),
  event_id: z.number().int().positive().optional(),
  description: z.string().min(3).max(2000),
  severity: z.enum(['low', 'medium', 'high']).default('low'),
});

router.post('/incidents', (req, res) => {
  const parsed = incidentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { participant_id, event_id, description, severity } = parsed.data;

  const result = db.prepare(`
    INSERT INTO incidents (participant_id, event_id, reported_by, description, severity)
    VALUES (?, ?, ?, ?, ?)
  `).run(participant_id || null, event_id || null, req.user.id, description, severity);

  logAction(req.user.id, 'incident_filed', { incidentId: result.lastInsertRowid, severity }, req);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.get('/incidents', (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, p.name AS participant_name, e.name AS event_name, u.name AS reported_by_name
    FROM incidents i
    LEFT JOIN participants p ON p.id = i.participant_id
    LEFT JOIN events e ON e.id = i.event_id
    LEFT JOIN users u ON u.id = i.reported_by
    ORDER BY i.created_at DESC
  `).all();
  res.json(rows);
});

module.exports = router;
