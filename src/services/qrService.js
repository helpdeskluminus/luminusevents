const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const QRCode = require('qrcode');

const QR_SECRET = process.env.QR_TOKEN_SECRET;

if (!QR_SECRET || QR_SECRET.length < 32) {
  throw new Error('QR_TOKEN_SECRET is missing or too short. Set a strong random value in .env.');
}

// Deliberately a DIFFERENT secret from the login JWT_SECRET.
// If one secret is ever compromised, the other credential class stays safe.

function newJti() {
  return crypto.randomBytes(16).toString('hex');
}

// Signs a token that lives only inside the participant's QR code.
// jti is stored in the DB against the participant row so it can be
// individually revoked (e.g. lost badge, fraud) without touching anyone else.
function signParticipantToken(participantId, jti) {
  return jwt.sign(
    { sub: participantId, jti, purpose: 'fest_entry' },
    QR_SECRET,
    { expiresIn: '30d', issuer: 'techfest-checkin' }
  );
}

function verifyParticipantToken(token) {
  return jwt.verify(token, QR_SECRET, { issuer: 'techfest-checkin' });
}

async function generateQrPngDataUrl(token) {
  return QRCode.toDataURL(token, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
}

async function generateQrPngBuffer(token) {
  return QRCode.toBuffer(token, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
}

module.exports = { newJti, signParticipantToken, verifyParticipantToken, generateQrPngDataUrl, generateQrPngBuffer };
