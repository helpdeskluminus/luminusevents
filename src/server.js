require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const { bootstrapAdmin } = require('./bootstrap');
const { generalLimiter, loginLimiter, scanLimiter, forgotPasswordLimiter } = require('./middleware/rateLimiters');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const eventRoutes = require('./routes/events');
const scanRoutes = require('./routes/scan');
const disciplinaryRoutes = require('./routes/disciplinary');

const app = express();

// --- Security headers ---
app.use(helmet());
app.disable('x-powered-by');

// --- CORS: locked to a configured origin, not wide open ---
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: corsOrigin ? corsOrigin.split(',') : false,
  credentials: false,
}));

app.use(express.json({ limit: '1mb' }));
app.use(generalLimiter);

// Static demo frontend (admin / OC / disciplinary / scanner pages)
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Routes ---
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/auth/reset-password', forgotPasswordLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/scan', scanLimiter, scanRoutes);
app.use('/api/disciplinary', disciplinaryRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// --- 404 ---
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// --- Error handler: never leak stack traces to clients ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

bootstrapAdmin().finally(() => {
  app.listen(PORT, () => {
    console.log(`Techfest check-in server running on port ${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`NODE_ENV=${process.env.NODE_ENV || 'development'} — remember to set NODE_ENV=production and serve behind HTTPS in real deployment.`);
    }
  });
});
