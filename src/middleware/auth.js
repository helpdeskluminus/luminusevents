const { verifySessionToken } = require('../services/authService');
const db = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing or malformed Authorization header' });

  try {
    const payload = verifySessionToken(token);
    const user = db.prepare('SELECT id, name, email, role, event_id, is_active FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Account not found or disabled' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Restricts a route to specific roles, e.g. requireRole('admin')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions for this action' });
    }
    next();
  };
}

// For event_oc: forces every query to their own event_id, no matter what the client sends.
// This is the actual security boundary — it does not trust req.params/req.body.event_id.
function scopeEventId(req, res, next) {
  if (req.user.role === 'event_oc') {
    req.scopedEventId = req.user.event_id;
  } else {
    // admin / disciplinary may pass an event_id filter explicitly (or none = all events)
    req.scopedEventId = req.query.event_id ? Number(req.query.event_id) : null;
  }
  next();
}

module.exports = { requireAuth, requireRole, scopeEventId };
