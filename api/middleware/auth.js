const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing access token.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'change-me-in-env');
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token.' });
  }
}

function requireRole(...allowedRoles) {
  const normalizedAllowedRoles = allowedRoles.map(role => String(role).toLowerCase());

  return function roleGuard(req, res, next) {
    const role = String(req.auth?.role || '').toLowerCase();
    if (!role || !normalizedAllowedRoles.includes(role)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have access to this action.' });
    }

    return next();
  };
}

module.exports = { requireAuth, requireRole };
