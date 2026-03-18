const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rate-limit');

const authRouter = express.Router();
const avatarUploadsDir = path.join(__dirname, '..', 'uploads', 'avatars');
const maxAvatarFileSizeBytes = 2 * 1024 * 1024;
const allowedAvatarMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const avatarExtensionByMimeType = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

fs.mkdirSync(avatarUploadsDir, { recursive: true });

function normalizeRole(role) {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'admin') {
    return 'admin';
  }
  if (normalized === 'customer') {
    return 'customer';
  }
  return 'employee';
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

function normalizeStoredAvatarPath(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  return normalized || null;
}

function buildAvatarUrl(req, avatarPath) {
  const normalizedPath = normalizeStoredAvatarPath(avatarPath);
  if (!normalizedPath) {
    return null;
  }

  return `${req.protocol}://${req.get('host')}/${normalizedPath}`;
}

function deleteAvatarFile(avatarPath) {
  const normalizedPath = normalizeStoredAvatarPath(avatarPath);
  if (!normalizedPath) {
    return;
  }

  const absolutePath = path.join(__dirname, '..', normalizedPath);
  fs.promises.unlink(absolutePath).catch(error => {
    if (error && error.code !== 'ENOENT') {
      console.error('Failed to delete avatar file:', error);
    }
  });
}

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, avatarUploadsDir);
    },
    filename: (req, file, callback) => {
      const userId = Number(req.auth?.sub || 0) || 'user';
      const extension = avatarExtensionByMimeType[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.jpg';
      callback(null, `avatar-${userId}-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
    }
  }),
  limits: { fileSize: maxAvatarFileSizeBytes },
  fileFilter: (_req, file, callback) => {
    if (!allowedAvatarMimeTypes.has(file.mimetype)) {
      callback(new Error('INVALID_AVATAR_FILE'));
      return;
    }

    callback(null, true);
  }
});

function avatarUploadSingle(req, res, next) {
  avatarUpload.single('avatar')(req, res, error => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        error: 'AVATAR_TOO_LARGE',
        message: 'Avatar image must be 2 MB or smaller.'
      });
      return;
    }

    if (error.message === 'INVALID_AVATAR_FILE') {
      res.status(400).json({
        error: 'INVALID_AVATAR_FILE',
        message: 'Only JPG, PNG, and WebP images are allowed.'
      });
      return;
    }

    next(error);
  });
}

function mapUser(row, req) {
  const fullName = String(row.full_name ?? row.fullName ?? row.username ?? '').trim();
  const email = String(row.email ?? '').trim().toLowerCase();

  return {
    id: Number(row.id),
    username: String(row.username),
    fullName,
    email,
    avatarUrl: buildAvatarUrl(req, row.avatar_path ?? row.avatarPath ?? null),
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
      'SELECT id, username, email, full_name, avatar_path, role, password_hash, is_active FROM users WHERE username = ? LIMIT 1',
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

    const user = mapUser(dbUser, req);
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
      [username, email, fullName, passwordHash, 'customer', 1]
    );

    const insertedId = Number(insertResult.insertId);
    const user = { id: insertedId, username, fullName, email, avatarUrl: null, role: 'customer' };
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
      'SELECT id, username, email, full_name, avatar_path, role, is_active FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (!Array.isArray(rows) || rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not found or inactive.' });
    }

    return res.json({ user: mapUser(rows[0], req) });
  } catch (error) {
    console.error('Load me failed:', error);

    if (isDatabaseUnavailable(error)) {
      return res.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'Auth service unavailable.' });
    }

    return res.status(500).json({ error: 'AUTH_ERROR', message: 'Failed to load user profile.' });
  }
});

authRouter.put('/profile', requireAuth, avatarUploadSingle, async (req, res) => {
  const userId = Number(req.auth?.sub || 0);
  if (!userId) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid token payload.' });
  }

  const fullName = normalizeText(req.body?.fullName, 120);
  const email = normalizeEmail(req.body?.email);
  const username = normalizeText(req.body?.username, 50);
  const removeAvatar = String(req.body?.removeAvatar || '').toLowerCase() === 'true';
  const newAvatarPath = req.file ? `uploads/avatars/${req.file.filename}` : null;

  if (!fullName || !email || !username) {
    if (newAvatarPath) {
      deleteAvatarFile(newAvatarPath);
    }
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'fullName, email, and username are required.' });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    if (newAvatarPath) {
      deleteAvatarFile(newAvatarPath);
    }
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'A valid email is required.' });
  }

  let connection;
  let previousAvatarPath = null;
  let nextAvatarPath = null;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingRows] = await connection.execute(
      'SELECT id, is_active, avatar_path FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
      [userId]
    );

    if (!Array.isArray(existingRows) || existingRows.length === 0 || !existingRows[0].is_active) {
      await connection.rollback();
      if (newAvatarPath) {
        deleteAvatarFile(newAvatarPath);
      }
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not found or inactive.' });
    }

    previousAvatarPath = normalizeStoredAvatarPath(existingRows[0].avatar_path);
    nextAvatarPath = previousAvatarPath;

    if (removeAvatar) {
      nextAvatarPath = null;
    }

    if (newAvatarPath) {
      nextAvatarPath = newAvatarPath;
    }

    const [duplicateRows] = await connection.execute(
      'SELECT id, username, email FROM users WHERE (username = ? OR email = ?) AND id <> ? LIMIT 1',
      [username, email, userId]
    );

    if (Array.isArray(duplicateRows) && duplicateRows.length > 0) {
      const duplicate = duplicateRows[0];
      await connection.rollback();
      if (newAvatarPath) {
        deleteAvatarFile(newAvatarPath);
      }

      if (String(duplicate.username).toLowerCase() === username.toLowerCase()) {
        return res.status(409).json({ error: 'USERNAME_EXISTS', message: 'Username already exists.' });
      }

      return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'Email already exists.' });
    }

    await connection.execute(
      'UPDATE users SET username = ?, email = ?, full_name = ?, avatar_path = ? WHERE id = ?',
      [username, email, fullName, nextAvatarPath, userId]
    );

    const [updatedRows] = await connection.execute(
      'SELECT id, username, email, full_name, avatar_path, role, is_active FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (!Array.isArray(updatedRows) || updatedRows.length === 0 || !updatedRows[0].is_active) {
      await connection.rollback();
      if (newAvatarPath) {
        deleteAvatarFile(newAvatarPath);
      }
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not found or inactive.' });
    }

    const user = mapUser(updatedRows[0], req);
    const accessToken = createAccessToken(user);

    await connection.commit();
    if (previousAvatarPath && previousAvatarPath !== nextAvatarPath) {
      deleteAvatarFile(previousAvatarPath);
    }
    return res.json({ user, accessToken });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    if (newAvatarPath) {
      deleteAvatarFile(newAvatarPath);
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
