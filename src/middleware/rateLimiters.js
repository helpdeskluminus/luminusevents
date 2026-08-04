const rateLimit = require('express-rate-limit');

// Tight limit on login to blunt brute-force / credential-stuffing attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});

// Scanning happens rapidly and legitimately (many gate devices), so this is
// generous but still stops a runaway/misbehaving or malicious scanner client.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Scan rate too high from this client. Slow down.' },
});

// Forgot-password: strict limit to stop mail-bombing an inbox and to slow down
// brute-forcing of reset tokens via the reset-password endpoint.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again later.' },
});

// General API limiter as a baseline backstop
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, scanLimiter, generalLimiter, forgotPasswordLimiter };
