const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const BCRYPT_COST = 12;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = process.env.LOGIN_TOKEN_TTL || '8h';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is missing or too short. Set a strong random value in .env (see .env.example).');
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Session token: identifies who is logged in and their role/scope.
// Short-lived on purpose — a stolen token expires quickly.
function issueSessionToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      event_id: user.event_id || null,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL, issuer: 'techfest-checkin' }
  );
}

function verifySessionToken(token) {
  return jwt.verify(token, JWT_SECRET, { issuer: 'techfest-checkin' });
}

module.exports = { hashPassword, verifyPassword, issueSessionToken, verifySessionToken };
