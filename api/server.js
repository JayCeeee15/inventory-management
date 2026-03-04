const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const { authRouter } = require('./routes/auth.routes');
const { inventoryRouter } = require('./routes/inventory.routes');
const { pool } = require('./db');

const app = express();
const PORT = Number(process.env.API_PORT || 3001);
const defaultAllowedOrigins = [
  'http://localhost:4200',
  'http://127.0.0.1:4200',
  'http://localhost:4300',
  'http://127.0.0.1:4300'
];
const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : defaultAllowedOrigins;

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow curl/postman or same-origin server calls without Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS_BLOCKED for origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.use(express.json());

app.get('/api', (_req, res) => {
  res.json({
    service: 'auth-api',
    status: 'ok',
    endpoints: [
      '/api/health',
      '/api/auth/login',
      '/api/auth/signup',
      '/api/auth/me',
      '/api/auth/profile',
      '/api/inventory/categories',
      '/api/inventory/categories/:id',
      '/api/inventory/products',
      '/api/inventory/products/:id',
      '/api/inventory/sales',
      '/api/inventory/patient-issues',
      '/api/inventory/stock/movements',
      '/api/inventory/dashboard/summary'
    ]
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'auth-api', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'auth-api', database: 'unavailable' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/inventory', inventoryRouter);

app.use((err, _req, res, _next) => {
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`Auth API running at http://localhost:${PORT}/api`);
});
