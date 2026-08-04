const crypto = require('crypto');

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MINUTES = 30;

// Raw token goes in the email link only. We store its SHA-256 hash in the DB —
// same principle as password hashing: if the database ever leaks, the stored
// values can't be replayed to reset anyone's password.
function generateRawToken() {
  return crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function expiryTimestamp() {
  return new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
}

module.exports = { generateRawToken, hashToken, expiryTimestamp, RESET_TOKEN_TTL_MINUTES };
