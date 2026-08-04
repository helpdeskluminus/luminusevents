const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || './data/techfest.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Security-relevant pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','event_oc','disciplinary')),
  event_id INTEGER,              -- only set for event_oc; scopes their access
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  venue TEXT,
  capacity INTEGER,
  oc_user_id INTEGER,
  start_time TEXT,
  end_time TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  ticket_type TEXT DEFAULT 'general',
  qr_jti TEXT NOT NULL UNIQUE,   -- unique token id embedded in the signed QR, used for revocation
  qr_revoked INTEGER NOT NULL DEFAULT 0,
  mail_sent INTEGER NOT NULL DEFAULT 0,
  mail_sent_at TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(participant_id, event_id),
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scan_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  event_id INTEGER,              -- NULL for main gate scans
  scan_type TEXT NOT NULL CHECK(scan_type IN ('main_gate','zone_gate')),
  status TEXT NOT NULL CHECK(status IN ('success','duplicate','denied','revoked')),
  reason TEXT,
  device_id TEXT,
  scanned_by INTEGER,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (participant_id) REFERENCES participants(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (scanned_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER,
  event_id INTEGER,
  reported_by INTEGER NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low' CHECK(severity IN ('low','medium','high')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (participant_id) REFERENCES participants(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (reported_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,  -- SHA-256 of the raw token; raw token never touches the DB
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_logs_participant ON scan_logs(participant_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_event ON scan_logs(event_id, scan_type);
CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id);
`);

module.exports = db;
