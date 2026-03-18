const express = require('express');

const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const inventoryRouter = express.Router();

function isDatabaseUnavailable(error) {
  const unavailableCodes = [
    'ECONNREFUSED',
    'PROTOCOL_CONNECTION_LOST',
    'ER_ACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR'
  ];
  return unavailableCodes.includes(error?.code);
}

function sendDatabaseError(res, error, fallbackMessage) {
  console.error(fallbackMessage, error);

  if (isDatabaseUnavailable(error)) {
    return res.status(503).json({ error: 'DB_UNAVAILABLE', message: 'Database service unavailable.' });
  }

  return res.status(500).json({ error: 'INVENTORY_ERROR', message: fallbackMessage });
}

function parsePositiveInt(value, fallbackValue, maxValue = 100) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.min(parsed, maxValue);
}

function parseOptionalId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeText(value, maxLen = 255) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLen);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
  }
  return fallback;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const [year, month, day] = trimmed.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return trimmed;
}

function parseCurrencyAmount(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  return Number(numericValue.toFixed(2));
}

function normalizeProductUnit(value) {
  const normalized = normalizeText(value, 30).toLowerCase();

  switch (normalized) {
    case 'box':
      return 'Box';
    case 'piece':
    case 'pieces':
      return 'Pieces';
    case 'pack':
    case 'packs':
      return 'Packs';
    default:
      return '';
  }
}

function toApiStockRow(row) {
  return {
    id: Number(row.id),
    sku: String(row.sku),
    name: String(row.name),
    description: row.description ? String(row.description) : '',
    unit: normalizeProductUnit(row.unit) || 'Box',
    price: Number(row.price),
    reorderLevel: Number(row.reorder_level),
    controlled: Boolean(row.controlled_flag),
    isActive: Boolean(row.is_active),
    category: {
      id: Number(row.category_id),
      name: String(row.category_name)
    },
    qtyOnHand: Number(row.qty_on_hand || 0),
    qtyReserved: Number(row.qty_reserved || 0),
    qtyAvailable: Number(row.qty_available || 0)
  };
}

function buildRefNo(prefix) {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');
  const randomTail = String(Math.floor(Math.random() * 9000) + 1000);
  return `${prefix}-${timestamp}${randomTail}`.slice(0, 30);
}

function buildPatientId(patientNumber) {
  return `PT-${patientNumber}`;
}

async function writeAuditLog(connection, req, details) {
  const payload = {
    actorUserId: Number(req.auth?.sub || 0) || null,
    action: normalizeText(details.action, 80) || 'UNKNOWN',
    entityType: normalizeText(details.entityType, 80) || 'UNKNOWN',
    entityId: details.entityId !== undefined && details.entityId !== null ? String(details.entityId) : null,
    beforeState: details.beforeState ?? null,
    afterState: details.afterState ?? null,
    meta: details.meta ?? null,
    ip: normalizeText(req.ip || '', 45) || null,
    userAgent: normalizeText(req.headers['user-agent'] || '', 255) || null
  };

  await connection.execute(
    `INSERT INTO audit_logs (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      before_state,
      after_state,
      meta,
      ip,
      user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.actorUserId,
      payload.action,
      payload.entityType,
      payload.entityId,
      payload.beforeState ? JSON.stringify(payload.beforeState) : null,
      payload.afterState ? JSON.stringify(payload.afterState) : null,
      payload.meta ? JSON.stringify(payload.meta) : null,
      payload.ip,
      payload.userAgent
    ]
  );
}

async function ensureInventoryRow(connection, productId, locationId) {
  await connection.execute(
    `INSERT INTO inventory_stock (product_id, location_id, qty_on_hand, qty_reserved)
     VALUES (?, ?, 0, 0)
     ON DUPLICATE KEY UPDATE product_id = VALUES(product_id)`,
    [productId, locationId]
  );

  const [rows] = await connection.execute(
    `SELECT qty_on_hand, qty_reserved
     FROM inventory_stock
     WHERE product_id = ? AND location_id = ?
     FOR UPDATE`,
    [productId, locationId]
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Failed to lock inventory row.');
  }

  return rows[0];
}

async function fetchProductById(connection, productId) {
  const [rows] = await connection.execute(
    `SELECT id, sku, name, price, is_active
     FROM products
     WHERE id = ?
     LIMIT 1`,
    [productId]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function fetchLocationById(connection, locationId) {
  const [rows] = await connection.execute(
    `SELECT id, code, name, is_active
     FROM locations
     WHERE id = ?
     LIMIT 1`,
    [locationId]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function getNextPatientNumber(connection) {
  const [rows] = await connection.execute(
    `SELECT COALESCE(MAX(id), 0) + 1 AS next_patient_number
     FROM patients`
  );

  const nextPatientNumber = Number(rows?.[0]?.next_patient_number || 1);
  return Number.isInteger(nextPatientNumber) && nextPatientNumber > 0 ? nextPatientNumber : 1;
}

async function syncPatientsAutoIncrement(connection) {
  const nextPatientNumber = await getNextPatientNumber(connection);
  const [autoIncrementRows] = await connection.execute(
    `SELECT AUTO_INCREMENT AS next_auto_increment
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'patients'
     LIMIT 1`
  );
  const currentAutoIncrement = Number(autoIncrementRows?.[0]?.next_auto_increment || 1);

  if (currentAutoIncrement !== Math.max(1, nextPatientNumber)) {
    await connection.query(`ALTER TABLE patients AUTO_INCREMENT = ${Math.max(1, nextPatientNumber)}`);
  }

  return nextPatientNumber;
}

async function restoreSaleStocks(connection, saleId) {
  const [rows] = await connection.execute(
    `SELECT
       product_id,
       location_id,
       SUM(quantity) AS quantity_to_restore
     FROM sale_items
     WHERE sale_id = ?
     GROUP BY product_id, location_id`,
    [saleId]
  );

  for (const row of Array.isArray(rows) ? rows : []) {
    const productId = Number(row.product_id || 0);
    const locationId = Number(row.location_id || 0);
    const quantityToRestore = Number(row.quantity_to_restore || 0);

    if (!productId || !locationId || quantityToRestore <= 0) {
      continue;
    }

    const stockRow = await ensureInventoryRow(connection, productId, locationId);
    const nextOnHand = Number(stockRow.qty_on_hand || 0) + quantityToRestore;

    await connection.execute(
      `UPDATE inventory_stock
       SET qty_on_hand = ?
       WHERE product_id = ? AND location_id = ?`,
      [nextOnHand, productId, locationId]
    );
  }
}

async function restoreAllSaleStocks(connection) {
  const [rows] = await connection.execute(
    `SELECT
       si.product_id,
       si.location_id,
       SUM(si.quantity) AS quantity_to_restore
     FROM sale_items si
     INNER JOIN sales s ON s.id = si.sale_id
     GROUP BY si.product_id, si.location_id`
  );

  for (const row of Array.isArray(rows) ? rows : []) {
    const productId = Number(row.product_id || 0);
    const locationId = Number(row.location_id || 0);
    const quantityToRestore = Number(row.quantity_to_restore || 0);

    if (!productId || !locationId || quantityToRestore <= 0) {
      continue;
    }

    const stockRow = await ensureInventoryRow(connection, productId, locationId);
    const nextOnHand = Number(stockRow.qty_on_hand || 0) + quantityToRestore;

    await connection.execute(
      `UPDATE inventory_stock
       SET qty_on_hand = ?
       WHERE product_id = ? AND location_id = ?`,
      [nextOnHand, productId, locationId]
    );
  }
}

async function restorePatientIssueStocks(connection, patientIssueId) {
  const [rows] = await connection.execute(
    `SELECT
       product_id,
       location_id,
       SUM(quantity) AS quantity_to_restore
     FROM issue_items
     WHERE patient_issue_id = ?
     GROUP BY product_id, location_id`,
    [patientIssueId]
  );

  for (const row of Array.isArray(rows) ? rows : []) {
    const productId = Number(row.product_id || 0);
    const locationId = Number(row.location_id || 0);
    const quantityToRestore = Number(row.quantity_to_restore || 0);

    if (!productId || !locationId || quantityToRestore <= 0) {
      continue;
    }

    const stockRow = await ensureInventoryRow(connection, productId, locationId);
    const nextOnHand = Number(stockRow.qty_on_hand || 0) + quantityToRestore;

    await connection.execute(
      `UPDATE inventory_stock
       SET qty_on_hand = ?
       WHERE product_id = ? AND location_id = ?`,
      [nextOnHand, productId, locationId]
    );
  }
}

async function reverseStandaloneMovement(connection, movementRow) {
  const productId = Number(movementRow.product_id || 0);
  const locationId = Number(movementRow.location_id || 0);
  const quantity = Number(movementRow.quantity || 0);

  if (!productId || !locationId || !Number.isInteger(quantity) || quantity === 0) {
    const error = new Error('Only stock receive and adjustment entries with valid item/location data can be deleted.');
    error.statusCode = 400;
    error.errorCode = 'UNSUPPORTED_DELETE';
    throw error;
  }

  const stockRow = await ensureInventoryRow(connection, productId, locationId);
  const currentOnHand = Number(stockRow.qty_on_hand || 0);
  const currentReserved = Number(stockRow.qty_reserved || 0);
  const nextOnHand = currentOnHand - quantity;

  if (nextOnHand < 0 || nextOnHand < currentReserved) {
    const error = new Error(
      'Deleting this transaction would make stock less than the reserved quantity or below zero.'
    );
    error.statusCode = 409;
    error.errorCode = 'INSUFFICIENT_STOCK';
    throw error;
  }

  await connection.execute(
    `UPDATE inventory_stock
     SET qty_on_hand = ?
     WHERE product_id = ? AND location_id = ?`,
    [nextOnHand, productId, locationId]
  );

  return {
    productId,
    locationId,
    qtyOnHand: nextOnHand,
    qtyReserved: currentReserved,
    qtyAvailable: nextOnHand - currentReserved
  };
}

async function createPatientRecord(connection, patientName, source = 'walk_in') {
  const [insertResult] = await connection.execute(
    `INSERT INTO patients (patient_id, full_name, source)
     VALUES (NULL, ?, ?)`,
    [patientName || null, source]
  );

  const patientRecordId = Number(insertResult.insertId || 0);
  if (!patientRecordId) {
    throw new Error('Failed to create patient record.');
  }

  const patientId = buildPatientId(patientRecordId);
  await connection.execute(
    `UPDATE patients
     SET patient_id = ?
     WHERE id = ?`,
    [patientId, patientRecordId]
  );

  return { patientRecordId, patientId };
}

inventoryRouter.get('/categories', requireAuth, async (req, res) => {
  const includeInactive = parseBoolean(req.query.includeInactive, false);

  try {
    const [rows] = await pool.execute(
      `SELECT
         c.id,
         c.name,
         c.description,
         c.is_active,
         c.created_at,
         c.updated_at,
         COUNT(p.id) AS product_count
       FROM categories c
       LEFT JOIN products p
         ON p.category_id = c.id
         AND p.is_active = 1
       ${includeInactive ? '' : 'WHERE c.is_active = 1'}
       GROUP BY c.id, c.name, c.description, c.is_active, c.created_at, c.updated_at
       ORDER BY c.name ASC`
    );

    return res.json({
      categories: rows.map(row => ({
        id: Number(row.id),
        name: String(row.name),
        description: row.description ? String(row.description) : '',
        isActive: Boolean(row.is_active),
        productCount: Number(row.product_count || 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load categories.');
  }
});

inventoryRouter.get('/categories/:id', requireAuth, async (req, res) => {
  const categoryId = parseOptionalId(req.params.id);
  if (!categoryId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid category id is required.' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT
         c.id,
         c.name,
         c.description,
         c.is_active,
         c.created_at,
         c.updated_at,
         COUNT(p.id) AS product_count
       FROM categories c
       LEFT JOIN products p
         ON p.category_id = c.id
         AND p.is_active = 1
       WHERE c.id = ?
       GROUP BY c.id, c.name, c.description, c.is_active, c.created_at, c.updated_at
       LIMIT 1`,
      [categoryId]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Category not found.' });
    }

    const row = rows[0];
    return res.json({
      category: {
        id: Number(row.id),
        name: String(row.name),
        description: row.description ? String(row.description) : '',
        isActive: Boolean(row.is_active),
        productCount: Number(row.product_count || 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load category.');
  }
});

inventoryRouter.post('/categories', requireAuth, requireRole('admin'), async (req, res) => {
  const name = normalizeText(req.body?.name, 120);
  const description = normalizeText(req.body?.description, 255);

  if (!name) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Category name is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [insertResult] = await connection.execute(
      `INSERT INTO categories (name, description, is_active)
       VALUES (?, ?, 1)`,
      [name, description || null]
    );

    const categoryId = Number(insertResult.insertId);
    await writeAuditLog(connection, req, {
      action: 'CATEGORY_CREATE',
      entityType: 'category',
      entityId: categoryId,
      afterState: { id: categoryId, name, description }
    });

    await connection.commit();
    return res.status(201).json({
      category: {
        id: categoryId,
        name,
        description,
        isActive: true
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'CATEGORY_EXISTS', message: 'Category name already exists.' });
    }

    return sendDatabaseError(res, error, 'Failed to create category.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.put('/categories/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const categoryId = parseOptionalId(req.params.id);
  const name = normalizeText(req.body?.name, 120);
  const description = normalizeText(req.body?.description, 255);
  const isActive = parseBoolean(req.body?.isActive, true);

  if (!categoryId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid category id is required.' });
  }

  if (!name) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Category name is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingRows] = await connection.execute(
      `SELECT id, name, description, is_active
       FROM categories
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [categoryId]
    );

    if (!Array.isArray(existingRows) || existingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Category not found.' });
    }

    const beforeState = existingRows[0];
    await connection.execute(
      `UPDATE categories
       SET name = ?, description = ?, is_active = ?
       WHERE id = ?`,
      [name, description || null, isActive ? 1 : 0, categoryId]
    );

    await writeAuditLog(connection, req, {
      action: 'CATEGORY_UPDATE',
      entityType: 'category',
      entityId: categoryId,
      beforeState,
      afterState: { id: categoryId, name, description, is_active: isActive ? 1 : 0 }
    });

    await connection.commit();
    return res.json({
      category: {
        id: categoryId,
        name,
        description,
        isActive
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'CATEGORY_EXISTS', message: 'Category name already exists.' });
    }

    return sendDatabaseError(res, error, 'Failed to update category.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.delete('/categories/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const categoryId = parseOptionalId(req.params.id);

  if (!categoryId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid category id is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingRows] = await connection.execute(
      `SELECT id, name, is_active
       FROM categories
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [categoryId]
    );

    if (!Array.isArray(existingRows) || existingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Category not found.' });
    }

    await connection.execute('UPDATE categories SET is_active = 0 WHERE id = ?', [categoryId]);
    await writeAuditLog(connection, req, {
      action: 'CATEGORY_ARCHIVE',
      entityType: 'category',
      entityId: categoryId,
      beforeState: existingRows[0],
      afterState: { ...existingRows[0], is_active: 0 }
    });

    await connection.commit();
    return res.json({ success: true });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'Failed to archive category.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.get('/locations', requireAuth, async (req, res) => {
  const includeInactive = parseBoolean(req.query.includeInactive, false);

  try {
    const [rows] = await pool.execute(
      `SELECT id, code, name, location_type, is_active
       FROM locations
       ${includeInactive ? '' : 'WHERE is_active = 1'}
       ORDER BY name ASC`
    );

    return res.json({
      locations: rows.map(row => ({
        id: Number(row.id),
        code: String(row.code),
        name: String(row.name),
        locationType: String(row.location_type),
        isActive: Boolean(row.is_active)
      }))
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load locations.');
  }
});

inventoryRouter.get('/products', requireAuth, async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1, 50000);
  const limit = parsePositiveInt(req.query.limit, 20, 100);
  const offset = (page - 1) * limit;
  const search = normalizeText(req.query.search, 120);
  const categoryId = parseOptionalId(req.query.categoryId);
  const locationId = parseOptionalId(req.query.locationId);
  const includeInactive = parseBoolean(req.query.includeInactive, false);

  const whereClauses = [];
  const params = [];

  if (!includeInactive) {
    whereClauses.push('p.is_active = 1', 'c.is_active = 1');
  }

  if (search) {
    whereClauses.push('(p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ?)');
    const searchLike = `%${search}%`;
    params.push(searchLike, searchLike, searchLike);
  }

  if (categoryId) {
    whereClauses.push('p.category_id = ?');
    params.push(categoryId);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const joinOnStock = locationId
    ? 'LEFT JOIN inventory_stock s ON s.product_id = p.id AND s.location_id = ?'
    : 'LEFT JOIN inventory_stock s ON s.product_id = p.id';

  try {
    const countSql = `
      SELECT COUNT(*) AS total
      FROM products p
      INNER JOIN categories c ON c.id = p.category_id
      ${whereSql}
    `;

    const [countRows] = await pool.execute(countSql, params);
    const total = Number(countRows[0]?.total || 0);

    const rowParams = [];
    if (locationId) {
      rowParams.push(locationId);
    }
    rowParams.push(...params);

    const [rows] = await pool.execute(
      `SELECT
         p.id,
         p.sku,
         p.name,
         p.description,
         p.unit,
         p.price,
         p.reorder_level,
         p.controlled_flag,
         p.is_active,
         c.id AS category_id,
         c.name AS category_name,
         COALESCE(SUM(s.qty_on_hand), 0) AS qty_on_hand,
         COALESCE(SUM(s.qty_reserved), 0) AS qty_reserved,
         COALESCE(SUM(s.qty_on_hand), 0) - COALESCE(SUM(s.qty_reserved), 0) AS qty_available
       FROM products p
       INNER JOIN categories c ON c.id = p.category_id
       ${joinOnStock}
       ${whereSql}
       GROUP BY
         p.id,
         p.sku,
         p.name,
         p.description,
         p.unit,
         p.price,
         p.reorder_level,
         p.controlled_flag,
         p.is_active,
         c.id,
         c.name
       ORDER BY p.name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      rowParams
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      page,
      limit,
      total,
      hasMore: offset + rows.length < total,
      products: rows.map(toApiStockRow)
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load products.');
  }
});

inventoryRouter.get('/products/:id', requireAuth, async (req, res) => {
  const productId = parseOptionalId(req.params.id);
  const locationId = parseOptionalId(req.query.locationId);
  const includeInactive = parseBoolean(req.query.includeInactive, false);

  if (!productId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid product id is required.' });
  }

  const whereSql = includeInactive ? 'WHERE p.id = ?' : 'WHERE p.id = ? AND p.is_active = 1 AND c.is_active = 1';
  const joinOnStock = locationId
    ? 'LEFT JOIN inventory_stock s ON s.product_id = p.id AND s.location_id = ?'
    : 'LEFT JOIN inventory_stock s ON s.product_id = p.id';

  const params = [];
  if (locationId) {
    params.push(locationId);
  }
  params.push(productId);

  try {
    const [rows] = await pool.execute(
      `SELECT
         p.id,
         p.sku,
         p.name,
         p.description,
         p.unit,
         p.price,
         p.reorder_level,
         p.controlled_flag,
         p.is_active,
         c.id AS category_id,
         c.name AS category_name,
         COALESCE(SUM(s.qty_on_hand), 0) AS qty_on_hand,
         COALESCE(SUM(s.qty_reserved), 0) AS qty_reserved,
         COALESCE(SUM(s.qty_on_hand), 0) - COALESCE(SUM(s.qty_reserved), 0) AS qty_available
       FROM products p
       INNER JOIN categories c ON c.id = p.category_id
       ${joinOnStock}
       ${whereSql}
       GROUP BY
         p.id,
         p.sku,
         p.name,
         p.description,
         p.unit,
         p.price,
         p.reorder_level,
         p.controlled_flag,
         p.is_active,
         c.id,
         c.name
       LIMIT 1`,
      params
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({ product: toApiStockRow(rows[0]) });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load product.');
  }
});

inventoryRouter.post('/products', requireAuth, requireRole('admin'), async (req, res) => {
  const categoryId = parseOptionalId(req.body?.categoryId);
  const sku = normalizeText(req.body?.sku, 64);
  const name = normalizeText(req.body?.name, 160);
  const description = normalizeText(req.body?.description, 255);
  const unit = normalizeProductUnit(req.body?.unit);
  const price = Number(req.body?.price ?? 0);
  const reorderLevel = Number(req.body?.reorderLevel ?? 0);
  const controlled = parseBoolean(req.body?.controlled, false);
  const initialStocks = Array.isArray(req.body?.initialStocks) ? req.body.initialStocks : [];

  if (!categoryId || !sku || !name) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'categoryId, sku, and name are required.'
    });
  }

  if (!unit) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'unit must be one of Box, Pieces, or Packs.'
    });
  }

  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'price must be a non-negative number.' });
  }

  if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
    return res
      .status(400)
      .json({ error: 'INVALID_INPUT', message: 'reorderLevel must be a non-negative integer.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [categoryRows] = await connection.execute(
      'SELECT id, is_active FROM categories WHERE id = ? LIMIT 1',
      [categoryId]
    );
    if (!Array.isArray(categoryRows) || categoryRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Category not found.' });
    }

    const [insertResult] = await connection.execute(
      `INSERT INTO products (
         category_id,
         sku,
         name,
         description,
         unit,
         price,
         reorder_level,
         controlled_flag,
         is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [categoryId, sku, name, description || null, unit, price, reorderLevel, controlled ? 1 : 0]
    );

    const productId = Number(insertResult.insertId);

    for (const stock of initialStocks) {
      const locationId = parseOptionalId(stock?.locationId);
      const quantity = Number(stock?.quantity ?? 0);
      const unitCost = Number(stock?.unitCost ?? price);
      if (!locationId || !Number.isInteger(quantity) || quantity < 0) {
        continue;
      }

      const location = await fetchLocationById(connection, locationId);
      if (!location) {
        continue;
      }

      await connection.execute(
        `INSERT INTO inventory_stock (product_id, location_id, qty_on_hand, qty_reserved)
         VALUES (?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE
           qty_on_hand = VALUES(qty_on_hand),
           qty_reserved = VALUES(qty_reserved)`,
        [productId, locationId, quantity]
      );

      if (quantity > 0) {
        await connection.execute(
          `INSERT INTO stock_movements (
             product_id,
             location_id,
             movement_type,
             quantity,
             unit_cost,
             reference_type,
             notes,
             created_by_user_id
           ) VALUES (?, ?, 'RECEIVE', ?, ?, 'manual', ?, ?)`,
          [productId, locationId, quantity, Number.isFinite(unitCost) ? unitCost : null, 'Initial stock', req.auth.sub]
        );
      }
    }

    await writeAuditLog(connection, req, {
      action: 'PRODUCT_CREATE',
      entityType: 'product',
      entityId: productId,
      afterState: {
        id: productId,
        categoryId,
        sku,
        name,
        unit,
        price,
        reorderLevel,
        controlled
      }
    });

    await connection.commit();
    return res.status(201).json({
      product: {
        id: productId,
        categoryId,
        sku,
        name,
        description,
        unit,
        price,
        reorderLevel,
        controlled,
        isActive: true
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'PRODUCT_EXISTS', message: 'Product SKU already exists.' });
    }

    return sendDatabaseError(res, error, 'Failed to create product.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.put('/products/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const productId = parseOptionalId(req.params.id);
  const categoryId = parseOptionalId(req.body?.categoryId);
  const sku = normalizeText(req.body?.sku, 64);
  const name = normalizeText(req.body?.name, 160);
  const description = normalizeText(req.body?.description, 255);
  const unit = normalizeProductUnit(req.body?.unit);
  const price = Number(req.body?.price ?? 0);
  const reorderLevel = Number(req.body?.reorderLevel ?? 0);
  const controlled = parseBoolean(req.body?.controlled, false);
  const isActive = parseBoolean(req.body?.isActive, true);

  if (!productId || !categoryId || !sku || !name) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'product id, categoryId, sku, and name are required.'
    });
  }

  if (!unit) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'unit must be one of Box, Pieces, or Packs.'
    });
  }

  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'price must be a non-negative number.' });
  }

  if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
    return res
      .status(400)
      .json({ error: 'INVALID_INPUT', message: 'reorderLevel must be a non-negative integer.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [beforeRows] = await connection.execute(
      `SELECT id, category_id, sku, name, description, unit, price, reorder_level, controlled_flag, is_active
       FROM products
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [productId]
    );

    if (!Array.isArray(beforeRows) || beforeRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
    }

    const [categoryRows] = await connection.execute('SELECT id FROM categories WHERE id = ? LIMIT 1', [categoryId]);
    if (!Array.isArray(categoryRows) || categoryRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Category not found.' });
    }

    await connection.execute(
      `UPDATE products
       SET category_id = ?,
           sku = ?,
           name = ?,
           description = ?,
           unit = ?,
           price = ?,
           reorder_level = ?,
           controlled_flag = ?,
           is_active = ?
       WHERE id = ?`,
      [categoryId, sku, name, description || null, unit, price, reorderLevel, controlled ? 1 : 0, isActive ? 1 : 0, productId]
    );

    await writeAuditLog(connection, req, {
      action: 'PRODUCT_UPDATE',
      entityType: 'product',
      entityId: productId,
      beforeState: beforeRows[0],
      afterState: {
        id: productId,
        category_id: categoryId,
        sku,
        name,
        description,
        unit,
        price,
        reorder_level: reorderLevel,
        controlled_flag: controlled ? 1 : 0,
        is_active: isActive ? 1 : 0
      }
    });

    await connection.commit();
    return res.json({
      product: {
        id: productId,
        categoryId,
        sku,
        name,
        description,
        unit,
        price,
        reorderLevel,
        controlled,
        isActive
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'PRODUCT_EXISTS', message: 'Product SKU already exists.' });
    }

    return sendDatabaseError(res, error, 'Failed to update product.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.delete('/products/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const productId = parseOptionalId(req.params.id);
  if (!productId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid product id is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [beforeRows] = await connection.execute(
      `SELECT id, name, sku, is_active
       FROM products
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [productId]
    );

    if (!Array.isArray(beforeRows) || beforeRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
    }

    await connection.execute('UPDATE products SET is_active = 0 WHERE id = ?', [productId]);
    await writeAuditLog(connection, req, {
      action: 'PRODUCT_ARCHIVE',
      entityType: 'product',
      entityId: productId,
      beforeState: beforeRows[0],
      afterState: { ...beforeRows[0], is_active: 0 }
    });

    await connection.commit();
    return res.json({ success: true });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'Failed to archive product.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.post('/stock/receive', requireAuth, requireRole('admin'), async (req, res) => {
  const productId = parseOptionalId(req.body?.productId);
  const locationId = parseOptionalId(req.body?.locationId);
  const quantity = Number(req.body?.quantity ?? 0);
  const unitCost = req.body?.unitCost === undefined ? null : Number(req.body.unitCost);
  const notes = normalizeText(req.body?.notes, 255);

  if (!productId || !locationId || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'productId, locationId and positive integer quantity are required.'
    });
  }

  if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'unitCost must be a non-negative number.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const product = await fetchProductById(connection, productId);
    if (!product || !product.is_active) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Active product not found.' });
    }

    const location = await fetchLocationById(connection, locationId);
    if (!location || !location.is_active) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Active location not found.' });
    }

    const stockRow = await ensureInventoryRow(connection, productId, locationId);
    const nextOnHand = Number(stockRow.qty_on_hand) + quantity;

    await connection.execute(
      `UPDATE inventory_stock
       SET qty_on_hand = ?
       WHERE product_id = ? AND location_id = ?`,
      [nextOnHand, productId, locationId]
    );

    await connection.execute(
      `INSERT INTO stock_movements (
         product_id,
         location_id,
         movement_type,
         quantity,
         unit_cost,
         reference_type,
         notes,
         created_by_user_id
       ) VALUES (?, ?, 'RECEIVE', ?, ?, 'manual', ?, ?)`,
      [productId, locationId, quantity, unitCost, notes || null, req.auth.sub]
    );

    await writeAuditLog(connection, req, {
      action: 'STOCK_RECEIVE',
      entityType: 'inventory_stock',
      entityId: `${productId}:${locationId}`,
      beforeState: { qty_on_hand: Number(stockRow.qty_on_hand), qty_reserved: Number(stockRow.qty_reserved) },
      afterState: { qty_on_hand: nextOnHand, qty_reserved: Number(stockRow.qty_reserved) },
      meta: { productId, locationId, quantity, unitCost, notes }
    });

    await connection.commit();
    return res.status(201).json({
      stock: {
        productId,
        locationId,
        qtyOnHand: nextOnHand,
        qtyReserved: Number(stockRow.qty_reserved),
        qtyAvailable: nextOnHand - Number(stockRow.qty_reserved)
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'Failed to receive stock.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.post('/stock/adjust', requireAuth, requireRole('admin'), async (req, res) => {
  const productId = parseOptionalId(req.body?.productId);
  const locationId = parseOptionalId(req.body?.locationId);
  const quantityChange = Number(req.body?.quantityChange ?? 0);
  const reason = normalizeText(req.body?.reason, 255);

  if (!productId || !locationId || !Number.isInteger(quantityChange) || quantityChange === 0) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'productId, locationId and non-zero integer quantityChange are required.'
    });
  }

  if (!reason) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Adjustment reason is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const product = await fetchProductById(connection, productId);
    if (!product || !product.is_active) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Active product not found.' });
    }

    const location = await fetchLocationById(connection, locationId);
    if (!location || !location.is_active) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Active location not found.' });
    }

    const stockRow = await ensureInventoryRow(connection, productId, locationId);
    const currentOnHand = Number(stockRow.qty_on_hand);
    const currentReserved = Number(stockRow.qty_reserved);
    const nextOnHand = currentOnHand + quantityChange;
    if (nextOnHand < 0 || nextOnHand < currentReserved) {
      await connection.rollback();
      return res.status(409).json({
        error: 'INSUFFICIENT_STOCK',
        message: 'Adjustment would make stock less than reserved/zero.'
      });
    }

    await connection.execute(
      `UPDATE inventory_stock
       SET qty_on_hand = ?
       WHERE product_id = ? AND location_id = ?`,
      [nextOnHand, productId, locationId]
    );

    await connection.execute(
      `INSERT INTO stock_movements (
         product_id,
         location_id,
         movement_type,
         quantity,
         reference_type,
         notes,
         created_by_user_id
       ) VALUES (?, ?, ?, ?, 'adjustment', ?, ?)`,
      [
        productId,
        locationId,
        quantityChange > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        quantityChange,
        reason,
        req.auth.sub
      ]
    );

    await writeAuditLog(connection, req, {
      action: 'STOCK_ADJUST',
      entityType: 'inventory_stock',
      entityId: `${productId}:${locationId}`,
      beforeState: { qty_on_hand: currentOnHand, qty_reserved: currentReserved },
      afterState: { qty_on_hand: nextOnHand, qty_reserved: currentReserved },
      meta: { quantityChange, reason }
    });

    await connection.commit();
    return res.json({
      stock: {
        productId,
        locationId,
        qtyOnHand: nextOnHand,
        qtyReserved: currentReserved,
        qtyAvailable: nextOnHand - currentReserved
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'Failed to adjust stock.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.get('/patients/next-id', requireAuth, requireRole('employee'), async (_req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const nextPatientNumber = await syncPatientsAutoIncrement(connection);
    res.set('Cache-Control', 'no-store');
    return res.json({
      patientId: buildPatientId(nextPatientNumber),
      nextPatientNumber
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load next patient ID.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.post('/sales', requireAuth, requireRole('employee'), async (req, res) => {
  const saleChannel = normalizeText(req.body?.saleChannel, 20).toLowerCase() || 'walk_in';
  const patientName = normalizeText(req.body?.patientName, 120);
  const notes = normalizeText(req.body?.notes, 255);
  const paymentMethod =
    normalizeText(req.body?.paymentMethod, 20).toLowerCase() || (saleChannel === 'online' ? 'card' : 'cash');
  const amountPaid = parseCurrencyAmount(req.body?.amountPaid);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!['walk_in', 'online'].includes(saleChannel)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'saleChannel must be walk_in or online.' });
  }

  if (!['cash', 'card'].includes(paymentMethod)) {
    return res
      .status(400)
      .json({ error: 'INVALID_INPUT', message: 'paymentMethod must be either cash or card.' });
  }

  if (amountPaid === null) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'amountPaid must be a valid positive amount.' });
  }

  if (items.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'At least one sale item is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let saleNo = '';
    let saleId = 0;
    const salePrefix = saleChannel === 'online' ? 'ONL' : 'WALK';
    let generatedPatientId = null;

    if (saleChannel === 'walk_in') {
      const patientRecord = await createPatientRecord(connection, patientName, 'walk_in');
      generatedPatientId = patientRecord.patientId;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      saleNo = buildRefNo(salePrefix);

      try {
        const [saleInsert] = await connection.execute(
          `INSERT INTO sales (
             sale_no,
             sale_channel,
             patient_name,
             patient_id,
             total_amount,
             status,
             created_by_user_id
           ) VALUES (?, ?, ?, ?, 0, 'pending', ?)`,
          [saleNo, saleChannel, patientName || null, generatedPatientId, req.auth.sub]
        );
        saleId = Number(saleInsert.insertId);
        break;
      } catch (insertError) {
        if (insertError?.code === 'ER_DUP_ENTRY' && attempt < 4) {
          continue;
        }
        throw insertError;
      }
    }

    if (!saleId) {
      throw new Error('Unable to generate unique sale reference number.');
    }

    let totalAmount = 0;

    for (const rawItem of items) {
      const productId = parseOptionalId(rawItem?.productId);
      const locationId = parseOptionalId(rawItem?.locationId);
      const quantity = Number(rawItem?.quantity ?? 0);
      const customPrice = rawItem?.unitPrice === undefined ? null : Number(rawItem.unitPrice);

      if (!productId || !locationId || !Number.isInteger(quantity) || quantity <= 0) {
        await connection.rollback();
        return res.status(400).json({
          error: 'INVALID_INPUT',
          message: 'Each item requires productId, locationId, and positive integer quantity.'
        });
      }

      const product = await fetchProductById(connection, productId);
      if (!product || !product.is_active) {
        await connection.rollback();
        return res.status(404).json({ error: 'NOT_FOUND', message: `Product ${productId} not found.` });
      }

      const location = await fetchLocationById(connection, locationId);
      if (!location || !location.is_active) {
        await connection.rollback();
        return res.status(404).json({ error: 'NOT_FOUND', message: `Location ${locationId} not found.` });
      }

      const stockRow = await ensureInventoryRow(connection, productId, locationId);
      const qtyOnHand = Number(stockRow.qty_on_hand);
      const qtyReserved = Number(stockRow.qty_reserved);
      const qtyAvailable = qtyOnHand - qtyReserved;

      if (qtyAvailable < quantity) {
        await connection.rollback();
        return res.status(409).json({
          error: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock for product ${product.name}. Available: ${qtyAvailable}.`
        });
      }

      const nextOnHand = qtyOnHand - quantity;
      await connection.execute(
        `UPDATE inventory_stock
         SET qty_on_hand = ?
         WHERE product_id = ? AND location_id = ?`,
        [nextOnHand, productId, locationId]
      );

      const unitPrice = Number.isFinite(customPrice) && customPrice >= 0 ? customPrice : Number(product.price);
      totalAmount += unitPrice * quantity;

      await connection.execute(
        `INSERT INTO sale_items (sale_id, product_id, location_id, quantity, unit_price)
         VALUES (?, ?, ?, ?, ?)`,
        [saleId, productId, locationId, quantity, unitPrice]
      );

      await connection.execute(
        `INSERT INTO stock_movements (
           product_id,
           location_id,
           movement_type,
           quantity,
           unit_cost,
           reference_type,
           reference_id,
           notes,
           created_by_user_id
         ) VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?)`,
        [
          productId,
          locationId,
          saleChannel === 'online' ? 'SALE_ONLINE' : 'SALE_WALKIN',
          -quantity,
          unitPrice,
          saleId,
          notes || null,
          req.auth.sub
        ]
      );
    }

    const roundedTotalAmount = Number(totalAmount.toFixed(2));
    if (amountPaid < roundedTotalAmount) {
      await connection.rollback();
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: `Amount paid (${amountPaid.toFixed(2)}) cannot be less than total (${roundedTotalAmount.toFixed(2)}).`
      });
    }

    const changeAmount = Number((amountPaid - roundedTotalAmount).toFixed(2));

    await connection.execute(
      `UPDATE sales
       SET total_amount = ?, payment_method = ?, amount_paid = ?, change_amount = ?, status = 'completed'
       WHERE id = ?`,
      [roundedTotalAmount, paymentMethod, amountPaid, changeAmount, saleId]
    );

    await writeAuditLog(connection, req, {
      action: 'SALE_CREATE',
      entityType: 'sale',
      entityId: saleId,
      afterState: {
        id: saleId,
        sale_no: saleNo,
        sale_channel: saleChannel,
        patient_id: generatedPatientId,
        total_amount: roundedTotalAmount,
        payment_method: paymentMethod,
        amount_paid: amountPaid,
        change_amount: changeAmount,
        item_count: items.length
      }
    });

    await connection.commit();
    return res.status(201).json({
      sale: {
        id: saleId,
        saleNo,
        saleChannel,
        patientId: generatedPatientId,
        totalAmount: roundedTotalAmount,
        paymentMethod,
        amountPaid,
        changeAmount,
        itemCount: items.length,
        status: 'completed'
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'Failed to create sale.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.delete('/sales/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const saleId = parseOptionalId(req.params.id);

  if (!saleId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid sale id is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [saleRows] = await connection.execute(
      `SELECT id, sale_no, sale_channel, patient_id, patient_name, total_amount, status
       FROM sales
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [saleId]
    );

    if (!Array.isArray(saleRows) || saleRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Sale not found.' });
    }

    const sale = saleRows[0];
    await restoreSaleStocks(connection, saleId);

    const [saleItemCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM sale_items
       WHERE sale_id = ?`,
      [saleId]
    );

    const [movementCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM stock_movements
       WHERE reference_type = 'sale'
         AND reference_id = ?`,
      [saleId]
    );

    await connection.execute(
      `DELETE FROM stock_movements
       WHERE reference_type = 'sale'
         AND reference_id = ?`,
      [saleId]
    );

    await connection.execute('DELETE FROM sales WHERE id = ?', [saleId]);

    if (sale.patient_id) {
      await connection.execute('DELETE FROM patients WHERE patient_id = ?', [sale.patient_id]);
    }

    await writeAuditLog(connection, req, {
      action: 'SALE_DELETE',
      entityType: 'sale',
      entityId: saleId,
      beforeState: sale
    });

    await connection.commit();
    const nextPatientNumber = await syncPatientsAutoIncrement(connection);

    return res.json({
      success: true,
      deletedSaleId: saleId,
      saleNo: String(sale.sale_no || ''),
      deletedSaleItems: Number(saleItemCountRows?.[0]?.total || 0),
      deletedMovementLogs: Number(movementCountRows?.[0]?.total || 0),
      nextPatientId: buildPatientId(nextPatientNumber)
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'Failed to delete sale.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.delete('/transactions/:movementId', requireAuth, requireRole('admin'), async (req, res) => {
  const movementId = parseOptionalId(req.params.movementId);

  if (!movementId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid transaction id is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [movementRows] = await connection.execute(
      `SELECT
         m.id,
         m.product_id,
         p.name AS product_name,
         m.location_id,
         l.name AS location_name,
         m.movement_type,
         m.quantity,
         m.unit_cost,
         m.reference_type,
         m.reference_id,
         m.notes,
         m.created_at
       FROM stock_movements m
       INNER JOIN products p ON p.id = m.product_id
       LEFT JOIN locations l ON l.id = m.location_id
       WHERE m.id = ?
       LIMIT 1
       FOR UPDATE`,
      [movementId]
    );

    if (!Array.isArray(movementRows) || movementRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Transaction record not found.' });
    }

    const movement = movementRows[0];
    const movementType = String(movement.movement_type || '');
    const referenceType = String(movement.reference_type || '');
    const referenceId = movement.reference_id !== null ? Number(movement.reference_id) : null;

    let responsePayload = {
      success: true,
      deletedMovementId: movementId,
      deletedMovementType: movementType,
      deletedMovementLogs: 0,
      deletedSales: 0,
      deletedSaleItems: 0,
      deletedPatientIssues: 0,
      deletedIssueItems: 0,
      deletedPatients: 0,
      referenceNo: null
    };

    if (referenceType === 'sale' && referenceId) {
      const [saleRows] = await connection.execute(
        `SELECT id, sale_no, sale_channel, patient_id, patient_name, total_amount, status
         FROM sales
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [referenceId]
      );

      if (!Array.isArray(saleRows) || saleRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Linked sale not found.' });
      }

      const sale = saleRows[0];
      await restoreSaleStocks(connection, referenceId);

      const [saleItemCountRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM sale_items
         WHERE sale_id = ?`,
        [referenceId]
      );

      const [movementCountRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM stock_movements
         WHERE reference_type = 'sale'
           AND reference_id = ?`,
        [referenceId]
      );

      await connection.execute(
        `DELETE FROM stock_movements
         WHERE reference_type = 'sale'
           AND reference_id = ?`,
        [referenceId]
      );
      await connection.execute('DELETE FROM sales WHERE id = ?', [referenceId]);

      if (sale.patient_id) {
        const [deletedPatientResult] = await connection.execute('DELETE FROM patients WHERE patient_id = ?', [sale.patient_id]);
        responsePayload.deletedPatients = Number(deletedPatientResult?.affectedRows || 0);
      }

      await writeAuditLog(connection, req, {
        action: 'SALE_DELETE',
        entityType: 'sale',
        entityId: referenceId,
        beforeState: sale
      });

      responsePayload = {
        ...responsePayload,
        deletedMovementLogs: Number(movementCountRows?.[0]?.total || 0),
        deletedSales: 1,
        deletedSaleItems: Number(saleItemCountRows?.[0]?.total || 0),
        referenceNo: String(sale.sale_no || '')
      };
    } else if (referenceType === 'patient_issue' && referenceId) {
      const [issueRows] = await connection.execute(
        `SELECT id, issue_no, patient_id, patient_name, department, status, notes
         FROM patient_issues
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [referenceId]
      );

      if (!Array.isArray(issueRows) || issueRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Linked patient issue not found.' });
      }

      const issue = issueRows[0];
      await restorePatientIssueStocks(connection, referenceId);

      const [issueItemCountRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM issue_items
         WHERE patient_issue_id = ?`,
        [referenceId]
      );

      const [movementCountRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM stock_movements
         WHERE reference_type = 'patient_issue'
           AND reference_id = ?`,
        [referenceId]
      );

      await connection.execute(
        `DELETE FROM stock_movements
         WHERE reference_type = 'patient_issue'
           AND reference_id = ?`,
        [referenceId]
      );
      await connection.execute('DELETE FROM patient_issues WHERE id = ?', [referenceId]);

      await writeAuditLog(connection, req, {
        action: 'PATIENT_ISSUE_DELETE',
        entityType: 'patient_issue',
        entityId: referenceId,
        beforeState: issue
      });

      responsePayload = {
        ...responsePayload,
        deletedMovementLogs: Number(movementCountRows?.[0]?.total || 0),
        deletedPatientIssues: 1,
        deletedIssueItems: Number(issueItemCountRows?.[0]?.total || 0),
        referenceNo: String(issue.issue_no || '')
      };
    } else if (movementType === 'RECEIVE' || movementType === 'ADJUSTMENT_IN' || movementType === 'ADJUSTMENT_OUT') {
      const reversedStock = await reverseStandaloneMovement(connection, movement);

      await connection.execute('DELETE FROM stock_movements WHERE id = ?', [movementId]);

      await writeAuditLog(connection, req, {
        action: 'STOCK_MOVEMENT_DELETE',
        entityType: 'stock_movement',
        entityId: movementId,
        beforeState: movement,
        afterState: null,
        meta: {
          reversedStock
        }
      });

      responsePayload = {
        ...responsePayload,
        deletedMovementLogs: 1,
        referenceNo: referenceId ? `${referenceType} #${referenceId}` : null
      };
    } else {
      await connection.rollback();
      return res.status(400).json({
        error: 'UNSUPPORTED_DELETE',
        message: 'This transaction type cannot be deleted from history.'
      });
    }

    const [remainingRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM stock_movements`
    );

    await connection.commit();
    const nextPatientNumber = await syncPatientsAutoIncrement(connection);
    res.set('Cache-Control', 'no-store');

    return res.json({
      ...responsePayload,
      remainingTransactions: Number(remainingRows?.[0]?.total || 0),
      nextPatientId: buildPatientId(nextPatientNumber)
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        error: error.errorCode || 'TRANSACTION_DELETE_ERROR',
        message: error.message || 'Failed to delete transaction.'
      });
    }

    return sendDatabaseError(res, error, 'Failed to delete transaction.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.delete('/sales/reset/all', requireAuth, requireRole('admin'), async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [salesCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM sales`
    );
    const deletedSales = Number(salesCountRows?.[0]?.total || 0);

    const [saleItemCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM sale_items`
    );
    const deletedSaleItems = Number(saleItemCountRows?.[0]?.total || 0);

    const [patientIssueCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM patient_issues`
    );
    const deletedPatientIssues = Number(patientIssueCountRows?.[0]?.total || 0);

    const [issueItemCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM issue_items`
    );
    const deletedIssueItems = Number(issueItemCountRows?.[0]?.total || 0);

    const [movementCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM stock_movements`
    );
    const deletedMovementLogs = Number(movementCountRows?.[0]?.total || 0);

    const [receiveCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM stock_movements
       WHERE movement_type = 'RECEIVE'`
    );
    const deletedReceiveLogs = Number(receiveCountRows?.[0]?.total || 0);

    const [adjustmentCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM stock_movements
       WHERE movement_type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT')`
    );
    const deletedAdjustmentLogs = Number(adjustmentCountRows?.[0]?.total || 0);

    const [patientCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM patients`
    );
    const deletedPatients = Number(patientCountRows?.[0]?.total || 0);

    const [customerOrderCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM customer_orders`
    );
    const deletedCustomerOrders = Number(customerOrderCountRows?.[0]?.total || 0);

    const [customerOrderItemCountRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM customer_order_items`
    );
    const deletedCustomerOrderItems = Number(customerOrderItemCountRows?.[0]?.total || 0);

    await connection.execute(
      `UPDATE inventory_stock
       SET qty_on_hand = 0,
           qty_reserved = 0,
           last_counted_at = NULL`
    );
    await connection.execute(`DELETE FROM stock_movements`);
    await connection.execute(`DELETE FROM customer_orders`);
    await connection.execute(`DELETE FROM sales`);
    await connection.execute(`DELETE FROM patient_issues`);
    await connection.execute(`DELETE FROM patients`);

    await writeAuditLog(connection, req, {
      action: 'TRANSACTION_CLEAR_ALL',
      entityType: 'transaction_history',
      entityId: 'all',
      beforeState: {
        deletedSales,
        deletedSaleItems,
        deletedPatientIssues,
        deletedIssueItems,
        deletedMovementLogs,
        deletedReceiveLogs,
        deletedAdjustmentLogs,
        deletedPatients,
        deletedCustomerOrders,
        deletedCustomerOrderItems
      },
      afterState: {
        remainingTransactions: 0
      }
    });

    await connection.commit();
    const nextPatientNumber = await syncPatientsAutoIncrement(connection);
    res.set('Cache-Control', 'no-store');

    return res.json({
      success: true,
      deletedSales,
      deletedSaleItems,
      deletedPatientIssues,
      deletedIssueItems,
      deletedMovementLogs,
      deletedReceiveLogs,
      deletedAdjustmentLogs,
      deletedPatients,
      deletedCustomerOrders,
      deletedCustomerOrderItems,
      remainingTransactions: 0,
      nextPatientId: buildPatientId(nextPatientNumber)
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'Failed to clear transaction history.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.post('/patient-issues', requireAuth, requireRole('employee'), async (req, res) => {
  const patientName = normalizeText(req.body?.patientName, 120);
  const patientId = normalizeText(req.body?.patientId, 40);
  const department = normalizeText(req.body?.department, 120);
  const notes = normalizeText(req.body?.notes, 255);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!patientName || !department) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'patientName and department are required.' });
  }

  if (items.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'At least one issue item is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const issueNo = buildRefNo('ISS');
    const [issueInsert] = await connection.execute(
      `INSERT INTO patient_issues (
         issue_no,
         patient_name,
         patient_id,
         department,
         status,
         issued_by_user_id,
         notes
       ) VALUES (?, ?, ?, ?, 'issued', ?, ?)`,
      [issueNo, patientName, patientId || null, department, req.auth.sub, notes || null]
    );

    const patientIssueId = Number(issueInsert.insertId);

    for (const rawItem of items) {
      const productId = parseOptionalId(rawItem?.productId);
      const locationId = parseOptionalId(rawItem?.locationId);
      const quantity = Number(rawItem?.quantity ?? 0);

      if (!productId || !locationId || !Number.isInteger(quantity) || quantity <= 0) {
        await connection.rollback();
        return res.status(400).json({
          error: 'INVALID_INPUT',
          message: 'Each issue item requires productId, locationId, and positive integer quantity.'
        });
      }

      const product = await fetchProductById(connection, productId);
      if (!product || !product.is_active) {
        await connection.rollback();
        return res.status(404).json({ error: 'NOT_FOUND', message: `Product ${productId} not found.` });
      }

      const location = await fetchLocationById(connection, locationId);
      if (!location || !location.is_active) {
        await connection.rollback();
        return res.status(404).json({ error: 'NOT_FOUND', message: `Location ${locationId} not found.` });
      }

      const stockRow = await ensureInventoryRow(connection, productId, locationId);
      const qtyOnHand = Number(stockRow.qty_on_hand);
      const qtyReserved = Number(stockRow.qty_reserved);
      const qtyAvailable = qtyOnHand - qtyReserved;

      if (qtyAvailable < quantity) {
        await connection.rollback();
        return res.status(409).json({
          error: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock for product ${product.name}. Available: ${qtyAvailable}.`
        });
      }

      const nextOnHand = qtyOnHand - quantity;
      await connection.execute(
        `UPDATE inventory_stock
         SET qty_on_hand = ?
         WHERE product_id = ? AND location_id = ?`,
        [nextOnHand, productId, locationId]
      );

      await connection.execute(
        `INSERT INTO issue_items (patient_issue_id, product_id, location_id, quantity)
         VALUES (?, ?, ?, ?)`,
        [patientIssueId, productId, locationId, quantity]
      );

      await connection.execute(
        `INSERT INTO stock_movements (
           product_id,
           location_id,
           movement_type,
           quantity,
           reference_type,
           reference_id,
           notes,
           created_by_user_id
         ) VALUES (?, ?, 'PATIENT_ISSUE', ?, 'patient_issue', ?, ?, ?)`,
        [productId, locationId, -quantity, patientIssueId, notes || null, req.auth.sub]
      );
    }

    await writeAuditLog(connection, req, {
      action: 'PATIENT_ISSUE_CREATE',
      entityType: 'patient_issue',
      entityId: patientIssueId,
      afterState: {
        id: patientIssueId,
        issue_no: issueNo,
        patient_name: patientName,
        department,
        item_count: items.length
      }
    });

    await connection.commit();
    return res.status(201).json({
      patientIssue: {
        id: patientIssueId,
        issueNo,
        patientName,
        department,
        itemCount: items.length,
        status: 'issued'
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'Failed to create patient issue.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

inventoryRouter.get('/stock/movements', requireAuth, async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1, 50000);
  const limit = parsePositiveInt(req.query.limit, 20, 100);
  const offset = (page - 1) * limit;
  const productId = parseOptionalId(req.query.productId);
  const locationId = parseOptionalId(req.query.locationId);
  const movementType = normalizeText(req.query.movementType, 30);
  const patientIdSearch = normalizeText(req.query.patientId, 40);
  const rawDateFrom = normalizeText(req.query.dateFrom, 20);
  const rawDateTo = normalizeText(req.query.dateTo, 20);
  const dateFrom = parseDateOnly(rawDateFrom);
  const dateTo = parseDateOnly(rawDateTo);

  if (rawDateFrom && !dateFrom) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'dateFrom must be YYYY-MM-DD format.' });
  }

  if (rawDateTo && !dateTo) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'dateTo must be YYYY-MM-DD format.' });
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'dateFrom cannot be later than dateTo.' });
  }

  const whereClauses = [];
  const params = [];

  if (productId) {
    whereClauses.push('m.product_id = ?');
    params.push(productId);
  }

  if (locationId) {
    whereClauses.push('m.location_id = ?');
    params.push(locationId);
  }

  if (movementType) {
    whereClauses.push('m.movement_type = ?');
    params.push(movementType.toUpperCase());
  }

  if (patientIdSearch) {
    whereClauses.push('(COALESCE(s.patient_id, pi.patient_id, \'\') LIKE ?)');
    params.push(`%${patientIdSearch}%`);
  }

  if (dateFrom) {
    whereClauses.push('m.created_at >= ?');
    params.push(`${dateFrom} 00:00:00`);
  }

  if (dateTo) {
    whereClauses.push('m.created_at <= ?');
    params.push(`${dateTo} 23:59:59`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM stock_movements m
       LEFT JOIN sales s
         ON m.reference_type = 'sale'
        AND s.id = m.reference_id
       LEFT JOIN customer_orders co
         ON m.reference_type = 'customer_order'
        AND co.id = m.reference_id
       LEFT JOIN patient_issues pi
         ON m.reference_type = 'patient_issue'
        AND pi.id = m.reference_id
       ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await pool.execute(
      `SELECT
         m.id,
         m.product_id,
         p.name AS product_name,
         m.location_id,
         l.name AS location_name,
         m.movement_type,
         m.quantity,
         m.unit_cost,
         m.reference_type,
         m.reference_id,
         m.notes,
         m.created_by_user_id,
         u.username AS created_by_username,
         s.sale_no,
         s.patient_id AS sale_patient_id,
         s.patient_name AS sale_patient_name,
         co.order_no,
         co.customer_name AS customer_order_name,
         pi.issue_no,
         pi.patient_id AS issue_patient_id,
         pi.patient_name AS issue_patient_name,
         m.created_at
       FROM stock_movements m
       INNER JOIN products p ON p.id = m.product_id
       LEFT JOIN locations l ON l.id = m.location_id
       LEFT JOIN users u ON u.id = m.created_by_user_id
       LEFT JOIN sales s
         ON m.reference_type = 'sale'
        AND s.id = m.reference_id
       LEFT JOIN customer_orders co
         ON m.reference_type = 'customer_order'
        AND co.id = m.reference_id
       LEFT JOIN patient_issues pi
         ON m.reference_type = 'patient_issue'
        AND pi.id = m.reference_id
       ${whereSql}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [...params]
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      page,
      limit,
      total,
      hasMore: offset + rows.length < total,
      movements: rows.map(row => ({
        id: Number(row.id),
        productId: Number(row.product_id),
        productName: String(row.product_name),
        locationId: row.location_id ? Number(row.location_id) : null,
        locationName: row.location_name ? String(row.location_name) : null,
        movementType: String(row.movement_type),
        quantity: Number(row.quantity),
        unitCost: row.unit_cost !== null ? Number(row.unit_cost) : null,
        referenceType: String(row.reference_type),
        referenceId: row.reference_id !== null ? Number(row.reference_id) : null,
        referenceNo: row.sale_no
          ? String(row.sale_no)
          : row.order_no
            ? String(row.order_no)
            : row.issue_no
              ? String(row.issue_no)
              : null,
        patientId: row.sale_patient_id
          ? String(row.sale_patient_id)
          : row.issue_patient_id
            ? String(row.issue_patient_id)
            : null,
        patientName: row.sale_patient_name
          ? String(row.sale_patient_name)
          : row.customer_order_name
            ? String(row.customer_order_name)
          : row.issue_patient_name
            ? String(row.issue_patient_name)
            : null,
        notes: row.notes ? String(row.notes) : '',
        createdBy: row.created_by_user_id
          ? { id: Number(row.created_by_user_id), username: String(row.created_by_username || '') }
          : null,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load stock movements.');
  }
});

inventoryRouter.get('/sales/:id/details', requireAuth, async (req, res) => {
  const saleId = parseOptionalId(req.params.id);

  if (!saleId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid sale id is required.' });
  }

  try {
    const [saleRows] = await pool.execute(
      `SELECT
         s.id,
         s.sale_no,
         s.sale_channel,
         s.patient_name,
         s.patient_id,
         s.total_amount,
         s.payment_method,
         s.amount_paid,
         s.change_amount,
         s.status,
         s.created_at,
         u.id AS created_by_user_id,
         u.username AS created_by_username,
         u.full_name AS created_by_full_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.created_by_user_id
       WHERE s.id = ?
       LIMIT 1`,
      [saleId]
    );

    if (!Array.isArray(saleRows) || saleRows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Sale not found.' });
    }

    const [itemRows] = await pool.execute(
      `SELECT
         si.id,
         si.product_id,
         p.name AS product_name,
         p.sku,
         si.location_id,
         l.name AS location_name,
         si.quantity,
         si.unit_price,
         si.line_total
       FROM sale_items si
       INNER JOIN products p ON p.id = si.product_id
       LEFT JOIN locations l ON l.id = si.location_id
       WHERE si.sale_id = ?
       ORDER BY si.id ASC`,
      [saleId]
    );

    const [noteRows] = await pool.execute(
      `SELECT notes
       FROM stock_movements
       WHERE reference_type = 'sale'
         AND reference_id = ?
         AND notes IS NOT NULL
         AND notes <> ''
       ORDER BY id ASC
       LIMIT 1`,
      [saleId]
    );

    const sale = saleRows[0];
    res.set('Cache-Control', 'no-store');
    return res.json({
      sale: {
        id: Number(sale.id),
        saleNo: String(sale.sale_no),
        saleChannel: String(sale.sale_channel),
        patientId: sale.patient_id ? String(sale.patient_id) : null,
        patientName: sale.patient_name ? String(sale.patient_name) : null,
        totalAmount: Number(sale.total_amount || 0),
        paymentMethod: String(sale.payment_method || 'cash'),
        amountPaid: Number(sale.amount_paid || 0),
        changeAmount: Number(sale.change_amount || 0),
        status: String(sale.status || 'completed'),
        notes: noteRows?.[0]?.notes ? String(noteRows[0].notes) : '',
        createdAt: sale.created_at,
        createdBy: sale.created_by_user_id
          ? {
              id: Number(sale.created_by_user_id),
              username: String(sale.created_by_username || ''),
              fullName: String(sale.created_by_full_name || '')
            }
          : null,
        items: Array.isArray(itemRows)
          ? itemRows.map(row => ({
              id: Number(row.id),
              productId: Number(row.product_id),
              productName: String(row.product_name || ''),
              sku: String(row.sku || ''),
              locationId: row.location_id !== null ? Number(row.location_id) : null,
              locationName: row.location_name ? String(row.location_name) : null,
              quantity: Number(row.quantity || 0),
              unitPrice: Number(row.unit_price || 0),
              lineTotal: Number(row.line_total || 0)
            }))
          : []
      }
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load sale details.');
  }
});

inventoryRouter.get('/dashboard/summary', requireAuth, async (_req, res) => {
  try {
    const [summaryRows] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM products WHERE is_active = 1) AS total_products,
         (SELECT COUNT(*) FROM categories WHERE is_active = 1) AS total_categories,
         (
           SELECT COALESCE(SUM(s.qty_on_hand), 0)
           FROM inventory_stock s
           INNER JOIN products p ON p.id = s.product_id
           WHERE p.is_active = 1
         ) AS stock_left,
         (
           SELECT COUNT(*)
           FROM (
             SELECT
               p.id,
               p.reorder_level,
               COALESCE(SUM(s.qty_on_hand), 0) - COALESCE(SUM(s.qty_reserved), 0) AS qty_available
             FROM products p
             LEFT JOIN inventory_stock s ON s.product_id = p.id
             WHERE p.is_active = 1
             GROUP BY p.id, p.reorder_level
           ) stock_summary
           WHERE stock_summary.qty_available > 0
             AND stock_summary.qty_available <= stock_summary.reorder_level
         ) AS low_stock_items,
         (
           SELECT COUNT(*)
           FROM (
             SELECT
               p.id,
               COALESCE(SUM(s.qty_on_hand), 0) - COALESCE(SUM(s.qty_reserved), 0) AS qty_available
             FROM products p
             LEFT JOIN inventory_stock s ON s.product_id = p.id
             WHERE p.is_active = 1
             GROUP BY p.id
           ) stock_summary
           WHERE stock_summary.qty_available <= 0
         ) AS out_of_stock_items,
         (
           SELECT COUNT(*)
           FROM sales
           WHERE sale_channel = 'walk_in'
             AND status = 'completed'
             AND created_at >= CURDATE()
         ) AS sales_today,
         (
           SELECT COUNT(*)
           FROM stock_movements
           WHERE created_at >= CURDATE()
         ) AS transactions_today,
         (
           SELECT COUNT(*)
           FROM stock_movements
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         ) AS stock_movements_last_7_days`
    );

    const row = Array.isArray(summaryRows) && summaryRows.length > 0 ? summaryRows[0] : {};

    res.set('Cache-Control', 'no-store');
    return res.json({
      summary: {
        totalProducts: Number(row.total_products || 0),
        totalCategories: Number(row.total_categories || 0),
        stockLeft: Number(row.stock_left || 0),
        lowStockItems: Number(row.low_stock_items || 0),
        outOfStockItems: Number(row.out_of_stock_items || 0),
        salesToday: Number(row.sales_today || 0),
        transactionsToday: Number(row.transactions_today || 0),
        stockMovementsLast7Days: Number(row.stock_movements_last_7_days || 0)
      }
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load dashboard summary.');
  }
});

inventoryRouter.get('/dashboard/stock-graph', requireAuth, async (req, res) => {
  const limit = parsePositiveInt(req.query.limit, 6, 50);

  try {
    const [rows] = await pool.execute(
      `SELECT
         p.id AS product_id,
         p.name AS product_name,
         c.name AS category_name,
         COALESCE(SUM(s.qty_on_hand), 0) AS qty_on_hand
       FROM products p
       INNER JOIN categories c ON c.id = p.category_id
       LEFT JOIN inventory_stock s ON s.product_id = p.id
       WHERE p.is_active = 1
         AND c.is_active = 1
       GROUP BY p.id, p.name, c.name
       ORDER BY qty_on_hand DESC, p.name ASC
       LIMIT ?`,
      [limit]
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      generatedAt: new Date().toISOString(),
      products: Array.isArray(rows)
        ? rows.map(row => ({
            productId: Number(row.product_id),
            productName: String(row.product_name),
            categoryName: String(row.category_name || 'General'),
            qtyOnHand: Number(row.qty_on_hand || 0)
          }))
        : []
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load stock graph data.');
  }
});

module.exports = { inventoryRouter };
