const db = require('../db');

const insertAudit = db.prepare(`
  INSERT INTO audit_log (actor_user_id, action, detail, ip_address)
  VALUES (?, ?, ?, ?)
`);

function logAction(actorUserId, action, detail, req) {
  try {
    insertAudit.run(
      actorUserId || null,
      action,
      typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
      req?.ip || null
    );
  } catch (err) {
    // Auditing must never crash the request; log and move on.
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { logAction };
