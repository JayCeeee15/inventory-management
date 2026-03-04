const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

function getRequestUsername(req) {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  return username || 'anonymous';
}

const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 50),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `${ipKeyGenerator(req.ip)}:${getRequestUsername(req)}`,
  message: {
    error: 'TOO_MANY_ATTEMPTS',
    message: 'Too many login attempts. Please try again later.'
  }
});

module.exports = { loginLimiter };
