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

function toApiStockRow(row) {
  return {
    id: Number(row.id),
    sku: String(row.sku),
    name: String(row.name),
    description: row.description ? String(row.description) : '',
    unit: String(row.unit),
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
  const unit = normalizeText(req.body?.unit, 30) || 'unit';
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
  const unit = normalizeText(req.body?.unit, 30) || 'unit';
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

inventoryRouter.post('/sales', requireAuth, async (req, res) => {
  const saleChannel = normalizeText(req.body?.saleChannel, 20).toLowerCase() || 'walk_in';
  const patientName = normalizeText(req.body?.patientName, 120);
  const patientId = normalizeText(req.body?.patientId, 40);
  const notes = normalizeText(req.body?.notes, 255);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!['walk_in', 'online'].includes(saleChannel)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'saleChannel must be walk_in or online.' });
  }

  if (items.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'At least one sale item is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const saleNo = buildRefNo(saleChannel === 'online' ? 'ONL' : 'WALK');
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
      [saleNo, saleChannel, patientName || null, patientId || null, req.auth.sub]
    );

    const saleId = Number(saleInsert.insertId);
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

    await connection.execute(
      `UPDATE sales
       SET total_amount = ?, status = 'completed'
       WHERE id = ?`,
      [totalAmount, saleId]
    );

    await writeAuditLog(connection, req, {
      action: 'SALE_CREATE',
      entityType: 'sale',
      entityId: saleId,
      afterState: {
        id: saleId,
        sale_no: saleNo,
        sale_channel: saleChannel,
        total_amount: totalAmount,
        item_count: items.length
      }
    });

    await connection.commit();
    return res.status(201).json({
      sale: {
        id: saleId,
        saleNo,
        saleChannel,
        totalAmount: Number(totalAmount.toFixed(2)),
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

inventoryRouter.post('/patient-issues', requireAuth, async (req, res) => {
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
         m.created_at
       FROM stock_movements m
       INNER JOIN products p ON p.id = m.product_id
       LEFT JOIN locations l ON l.id = m.location_id
       LEFT JOIN users u ON u.id = m.created_by_user_id
       ${whereSql}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [...params]
    );

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

inventoryRouter.get('/dashboard/summary', requireAuth, async (_req, res) => {
  try {
    const [productCountRows] = await pool.execute('SELECT COUNT(*) AS total FROM products WHERE is_active = 1');
    const [categoryCountRows] = await pool.execute('SELECT COUNT(*) AS total FROM categories WHERE is_active = 1');
    const [lowStockRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT
           p.id,
           p.reorder_level,
           COALESCE(SUM(s.qty_on_hand), 0) AS qty_on_hand
         FROM products p
         LEFT JOIN inventory_stock s ON s.product_id = p.id
         WHERE p.is_active = 1
         GROUP BY p.id, p.reorder_level
       ) stock_summary
       WHERE stock_summary.qty_on_hand <= stock_summary.reorder_level`
    );
    const [movementRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM stock_movements
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    return res.json({
      summary: {
        totalProducts: Number(productCountRows[0]?.total || 0),
        totalCategories: Number(categoryCountRows[0]?.total || 0),
        lowStockItems: Number(lowStockRows[0]?.total || 0),
        stockMovementsLast7Days: Number(movementRows[0]?.total || 0)
      }
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load dashboard summary.');
  }
});

module.exports = { inventoryRouter };
