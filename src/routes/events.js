const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, scopeEventId } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('event_oc'), scopeEventId);

// Live check-in list + counts for the OC's own event only
router.get('/my-event/dashboard', (req, res) => {
  const eventId = req.scopedEventId;
  if (!eventId) return res.status(400).json({ error: 'No event assigned to this account' });

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const registered = db.prepare('SELECT COUNT(*) c FROM registrations WHERE event_id = ?').get(eventId).c;
  const checkedIn = db.prepare(`
    SELECT COUNT(DISTINCT participant_id) c FROM scan_logs WHERE event_id = ? AND scan_type='zone_gate' AND status='success'
  `).get(eventId).c;

  const checkinList = db.prepare(`
    SELECT p.id, p.name, p.email, p.ticket_type, sl.timestamp AS checked_in_at
    FROM scan_logs sl
    JOIN participants p ON p.id = sl.participant_id
    WHERE sl.event_id = ? AND sl.scan_type = 'zone_gate' AND sl.status = 'success'
    ORDER BY sl.timestamp DESC
  `).all(eventId);

  res.json({
    event: { id: event.id, name: event.name, capacity: event.capacity, venue: event.venue },
    registered,
    checkedIn,
    checkinList,
  });
});

// Full registrant list (registered but not necessarily checked in yet)
router.get('/my-event/registrations', (req, res) => {
  const eventId = req.scopedEventId;
  const rows = db.prepare(`
    SELECT p.id, p.name, p.email, p.ticket_type,
      EXISTS(SELECT 1 FROM scan_logs sl WHERE sl.participant_id = p.id AND sl.event_id = ? AND sl.scan_type='zone_gate' AND sl.status='success') AS checked_in
    FROM registrations r
    JOIN participants p ON p.id = r.participant_id
    WHERE r.event_id = ?
    ORDER BY p.name
  `).all(eventId, eventId);
  res.json(rows);
});

module.exports = router;
