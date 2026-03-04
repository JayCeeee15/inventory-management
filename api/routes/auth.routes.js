const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rate-limit');

const authRouter = express.Router();

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'employee';
}

function normalizeText(value, maxLen) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLen);
}

function normalizeEmail(value) {
  return normalizeText(value, 120).toLowerCase();
}

function createAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role
    },
    process.env.JWT_SECRET || 'change-me-in-env',
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function mapUser(row) {
  const fullName = String(row.full_name ?? row.fullName ?? row.username ?? '').trim();
  const email = String(row.email ?? '').trim().toLowerCase();

  return {
    id: Number(row.id),
    username: String(row.username),
    fullName,
    email,
    role: normalizeRole(row.role)
  };
}

function isDatabaseUnavailable(error) {
  const unavailableCodes = [
    'ECONNREFUSED',
    'PROTOCOL_CONNECTION_LOST',
    'ER_ACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR'
  ];
  return unavailableCodes.includes(error.code);
}

authRouter.post('/login', loginLimiter, async (req, res) => {
  const username = normalizeText(req.body?.username, 50);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Username and password are required.' });
  }

  // helper: write to login_logs without breaking auth
  async function logLoginAttempt({ userId = null, uname, success }) {
    try {
      const logUsername = String(uname || '').slice(0, 50);
      const logIp = String(req.ip || '').slice(0, 45) || null;
      const logUserAgent = String(req.headers['user-agent'] || '').slice(0, 255) || null;

      await pool.execute(
        `INSERT INTO login_logs (user_id, username, success, ip, user_agent)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, logUsername, success ? 1 : 0, logIp, logUserAgent]
      );
    } catch (logErr) {
      console.error('Login log insert failed:', logErr);
    }
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, username, email, full_name, role, password_hash, is_active FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      await logLoginAttempt({ uname: username, success: false });
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
    }

    const dbUser = rows[0];

    if (!dbUser.is_active) {
      await logLoginAttempt({ userId: Number(dbUser.id), uname: String(dbUser.username), success: false });
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, dbUser.password_hash);
    if (!isPasswordValid) {
      await logLoginAttempt({ userId: Number(dbUser.id), uname: String(dbUser.username), success: false });
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
    }

    const user = mapUser(dbUser);
    const accessToken = createAccessToken(user);

    // ✅ successful login log
    await logLoginAttempt({ userId: user.id, uname: user.username, success: true });

    return res.json({ user, accessToken });
  } catch (error) {
    console.error('Login failed:', error);

    if (isDatabaseUnavailable(error)) {
      return res.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'Auth service unavailable.' });
    }

    return res.status(500).json({ error: 'AUTH_ERROR', message: 'Failed to process login.' });
  }
});

authRouter.post('/signup', async (req, res) => {
  const fullName = normalizeText(req.body?.fullName, 120);
  const email = normalizeEmail(req.body?.email);
  const username = normalizeText(req.body?.username, 50);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!fullName || !email || !username || !password) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'All signup fields are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Password must be at least 6 characters.' });
  }

  try {
    const [existingRows] = await pool.execute(
      'SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email]
    );

    if (Array.isArray(existingRows) && existingRows.length > 0) {
      const existingUser = existingRows[0];
      if (existingUser.username === username) {
        return res.status(409).json({ error: 'USERNAME_EXISTS', message: 'Username already exists.' });
      }

      return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'Email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [insertResult] = await pool.execute(
      'INSERT INTO users (username, email, full_name, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [username, email, fullName, passwordHash, 'employee', 1]
    );

    const insertedId = Number(insertResult.insertId);
    const user = { id: insertedId, username, fullName, email, role: 'employee' };
    const accessToken = createAccessToken(user);

    return res.status(201).json({ user, accessToken });
  } catch (error) {
    console.error('Signup failed:', error);

    if (isDatabaseUnavailable(error)) {
      return res.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'Auth service unavailable.' });
    }

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'USERNAME_EXISTS', message: 'Username or email already exists.' });
    }

    return res.status(500).json({ error: 'AUTH_ERROR', message: 'Failed to create account.' });
  }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const userId = Number(req.auth?.sub || 0);

  if (!userId) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid token payload.' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, username, email, full_name, role, is_active FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (!Array.isArray(rows) || rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not found or inactive.' });
    }

    return res.json({ user: mapUser(rows[0]) });
  } catch (error) {
    console.error('Load me failed:', error);

    if (isDatabaseUnavailable(error)) {
      return res.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'Auth service unavailable.' });
    }

    return res.status(500).json({ error: 'AUTH_ERROR', message: 'Failed to load user profile.' });
  }
});

authRouter.put('/profile', requireAuth, async (req, res) => {
  const userId = Number(req.auth?.sub || 0);
  if (!userId) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid token payload.' });
  }

  const fullName = normalizeText(req.body?.fullName, 120);
  const email = normalizeEmail(req.body?.email);
  const username = normalizeText(req.body?.username, 50);

  if (!fullName || !email || !username) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'fullName, email, and username are required.' });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'A valid email is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingRows] = await connection.execute(
      'SELECT id, is_active FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
      [userId]
    );

    if (!Array.isArray(existingRows) || existingRows.length === 0 || !existingRows[0].is_active) {
      await connection.rollback();
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not found or inactive.' });
    }

    const [duplicateRows] = await connection.execute(
      'SELECT id, username, email FROM users WHERE (username = ? OR email = ?) AND id <> ? LIMIT 1',
      [username, email, userId]
    );

    if (Array.isArray(duplicateRows) && duplicateRows.length > 0) {
      const duplicate = duplicateRows[0];
      await connection.rollback();

      if (String(duplicate.username).toLowerCase() === username.toLowerCase()) {
        return res.status(409).json({ error: 'USERNAME_EXISTS', message: 'Username already exists.' });
      }

      return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'Email already exists.' });
    }

    await connection.execute(
      'UPDATE users SET username = ?, email = ?, full_name = ? WHERE id = ?',
      [username, email, fullName, userId]
    );

    const [updatedRows] = await connection.execute(
      'SELECT id, username, email, full_name, role, is_active FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (!Array.isArray(updatedRows) || updatedRows.length === 0 || !updatedRows[0].is_active) {
      await connection.rollback();
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not found or inactive.' });
    }

    const user = mapUser(updatedRows[0]);
    const accessToken = createAccessToken(user);

    await connection.commit();
    return res.json({ user, accessToken });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Profile update failed:', error);

    if (isDatabaseUnavailable(error)) {
      return res.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'Auth service unavailable.' });
    }

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'PROFILE_EXISTS', message: 'Username or email already exists.' });
    }

    return res.status(500).json({ error: 'AUTH_ERROR', message: 'Failed to update profile.' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

module.exports = { authRouter };
