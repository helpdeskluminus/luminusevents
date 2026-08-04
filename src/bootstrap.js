require('dotenv').config();
const db = require('./db');
const { hashPassword } = require('./services/authService');

async function bootstrapAdmin() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME || 'Admin';

  if (!email || !password) {
    console.log('No BOOTSTRAP_ADMIN_EMAIL/PASSWORD set — skipping admin bootstrap.');
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    console.log(`Admin account already exists for ${email} — skipping.`);
    return;
  }

  if (password.length < 10) {
    console.warn('WARNING: bootstrap admin password is short. Change it after first login.');
  }

  const password_hash = await hashPassword(password);
  db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`)
    .run(name, email, password_hash);

  console.log(`Bootstrap admin created: ${email}`);
  console.log('IMPORTANT: log in and change this password immediately, then remove BOOTSTRAP_ADMIN_PASSWORD from .env');
}

module.exports = { bootstrapAdmin };
