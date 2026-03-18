const express = require('express');
const jwt = require('jsonwebtoken');

const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const shopRouter = express.Router();

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

  return res.status(500).json({ error: 'SHOP_ERROR', message: fallbackMessage });
}

function normalizeText(value, maxLen = 255) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLen);
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

function parsePositiveInt(value, fallbackValue, maxValue = 100) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.min(parsed, maxValue);
}

function buildOrderDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('');
}

function buildOrderReference(dateKey, sequence) {
  return `ORD-${dateKey}-${String(sequence).padStart(4, '0')}`;
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
    `SELECT id, sku, name, description, price, unit, is_active, category_id
     FROM products
     WHERE id = ?
     LIMIT 1`,
    [productId]
  );

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function fetchLocationById(connection, locationId) {
  const [rows] = await connection.execute(
    `SELECT id, code, name, location_type, is_active
     FROM locations
     WHERE id = ?
     LIMIT 1`,
    [locationId]
  );

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function resolvePreferredLocationId(connection, requestedLocationId = null) {
  if (requestedLocationId) {
    const requestedLocation = await fetchLocationById(connection, requestedLocationId);
    if (requestedLocation && requestedLocation.is_active) {
      return Number(requestedLocation.id);
    }
  }

  const [onlineRows] = await connection.execute(
    `SELECT id
     FROM locations
     WHERE is_active = 1 AND code = 'ONLINE'
     LIMIT 1`
  );

  if (Array.isArray(onlineRows) && onlineRows.length > 0) {
    return Number(onlineRows[0].id);
  }

  const [fallbackRows] = await connection.execute(
    `SELECT id
     FROM locations
     WHERE is_active = 1
     ORDER BY
       CASE WHEN location_type = 'online' THEN 0 ELSE 1 END,
       name ASC
     LIMIT 1`
  );

  if (Array.isArray(fallbackRows) && fallbackRows.length > 0) {
    return Number(fallbackRows[0].id);
  }

  return null;
}

async function getNextOrderSequence(connection, counterDate) {
  await connection.execute(
    `INSERT INTO order_counters (counter_date, \`last_value\`)
     VALUES (?, 0)
     ON DUPLICATE KEY UPDATE counter_date = VALUES(counter_date)`,
    [counterDate]
  );

  await connection.execute(
    `UPDATE order_counters
     SET \`last_value\` = LAST_INSERT_ID(\`last_value\` + 1)
     WHERE counter_date = ?`,
    [counterDate]
  );

  const [rows] = await connection.query('SELECT LAST_INSERT_ID() AS sequence');
  const sequence = Number(rows?.[0]?.sequence || 1);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 1;
}

async function generateOrderReference(connection) {
  const now = new Date();
  const counterDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  const dateKey = buildOrderDateKey(now);
  const sequence = await getNextOrderSequence(connection, counterDate);
  return buildOrderReference(dateKey, sequence);
}

function tryParseCustomerAuth(req) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'change-me-in-env');
    if (String(payload?.role || '').toLowerCase() !== 'customer') {
      return null;
    }
    return {
      userId: Number(payload.sub || 0) || null,
      username: String(payload.username || '')
    };
  } catch {
    return null;
  }
}

function mapPublicProductRow(row) {
  return {
    id: Number(row.id),
    sku: String(row.sku),
    name: String(row.name),
    description: row.description ? String(row.description) : '',
    unit: String(row.unit),
    price: Number(row.price || 0),
    categoryId: Number(row.category_id),
    categoryName: String(row.category_name),
    locationId: row.location_id !== null ? Number(row.location_id) : null,
    locationName: row.location_name ? String(row.location_name) : null,
    qtyOnHand: Number(row.qty_on_hand || 0),
    qtyReserved: Number(row.qty_reserved || 0),
    qtyAvailable: Number(row.qty_available || 0)
  };
}

async function restoreOrderReservations(connection, orderId) {
  const [rows] = await connection.execute(
    `SELECT product_id, location_id, SUM(quantity) AS qty_to_release
     FROM customer_order_items
     WHERE order_id = ?
     GROUP BY product_id, location_id`,
    [orderId]
  );

  for (const row of Array.isArray(rows) ? rows : []) {
    const productId = Number(row.product_id || 0);
    const locationId = Number(row.location_id || 0);
    const qtyToRelease = Number(row.qty_to_release || 0);

    if (!productId || !locationId || qtyToRelease <= 0) {
      continue;
    }

    const stockRow = await ensureInventoryRow(connection, productId, locationId);
    const currentReserved = Number(stockRow.qty_reserved || 0);
    const nextReserved = currentReserved - qtyToRelease;

    if (nextReserved < 0) {
      const error = new Error('Cancelling this order would make reserved stock negative.');
      error.statusCode = 409;
      error.errorCode = 'INVALID_STOCK_RELEASE';
      throw error;
    }

    await connection.execute(
      `UPDATE inventory_stock
       SET qty_reserved = ?
       WHERE product_id = ? AND location_id = ?`,
      [nextReserved, productId, locationId]
    );
  }
}

async function fulfillOrderInventory(connection, orderId, orderNo, actorUserId) {
  const [rows] = await connection.execute(
    `SELECT
       oi.product_id,
       oi.location_id,
       oi.quantity,
       oi.unit_price
     FROM customer_order_items oi
     WHERE oi.order_id = ?
     ORDER BY oi.id ASC`,
    [orderId]
  );

  for (const row of Array.isArray(rows) ? rows : []) {
    const productId = Number(row.product_id || 0);
    const locationId = Number(row.location_id || 0);
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.unit_price || 0);

    if (!productId || !locationId || quantity <= 0) {
      continue;
    }

    const stockRow = await ensureInventoryRow(connection, productId, locationId);
    const currentOnHand = Number(stockRow.qty_on_hand || 0);
    const currentReserved = Number(stockRow.qty_reserved || 0);

    if (currentReserved < quantity) {
      const error = new Error('Reserved stock is lower than the order quantity for one or more items.');
      error.statusCode = 409;
      error.errorCode = 'INVALID_RESERVED_STOCK';
      throw error;
    }

    if (currentOnHand < quantity) {
      const error = new Error('On-hand stock is too low to fulfill this order.');
      error.statusCode = 409;
      error.errorCode = 'INSUFFICIENT_STOCK';
      throw error;
    }

    await connection.execute(
      `UPDATE inventory_stock
       SET qty_on_hand = ?, qty_reserved = ?
       WHERE product_id = ? AND location_id = ?`,
      [currentOnHand - quantity, currentReserved - quantity, productId, locationId]
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
       ) VALUES (?, ?, 'SALE_ONLINE', ?, ?, 'customer_order', ?, ?, ?)`,
      [productId, locationId, -quantity, unitPrice, orderId, `Fulfilled order ${orderNo}`, actorUserId]
    );
  }
}

shopRouter.get('/public/locations', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, code, name, location_type
       FROM locations
       WHERE is_active = 1
       ORDER BY
         CASE WHEN code = 'ONLINE' THEN 0 ELSE 1 END,
         name ASC`
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      locations: (Array.isArray(rows) ? rows : []).map(row => ({
        id: Number(row.id),
        code: String(row.code),
        name: String(row.name),
        locationType: String(row.location_type)
      }))
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load shop locations.');
  }
});

shopRouter.get('/public/categories', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         c.id,
         c.name,
         c.description,
         COUNT(DISTINCT p.id) AS product_count
       FROM categories c
       LEFT JOIN products p
         ON p.category_id = c.id
        AND p.is_active = 1
       WHERE c.is_active = 1
       GROUP BY c.id, c.name, c.description
       ORDER BY c.name ASC`
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      categories: (Array.isArray(rows) ? rows : []).map(row => ({
        id: Number(row.id),
        name: String(row.name),
        description: row.description ? String(row.description) : '',
        productCount: Number(row.product_count || 0)
      }))
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load shop categories.');
  }
});

shopRouter.get('/public/products', async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1, 50000);
  const limit = parsePositiveInt(req.query.limit, 12, 60);
  const offset = (page - 1) * limit;
  const search = normalizeText(req.query.search, 120);
  const categoryId = parseOptionalId(req.query.categoryId);
  const requestedLocationId = parseOptionalId(req.query.locationId);

  let connection;
  try {
    connection = await pool.getConnection();
    const locationId = await resolvePreferredLocationId(connection, requestedLocationId);

    const whereClauses = ['p.is_active = 1', 'c.is_active = 1'];
    const params = [];

    if (search) {
      const searchLike = `%${search}%`;
      whereClauses.push('(p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ?)');
      params.push(searchLike, searchLike, searchLike);
    }

    if (categoryId) {
      whereClauses.push('p.category_id = ?');
      params.push(categoryId);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
    const joinOnStock = locationId
      ? 'LEFT JOIN inventory_stock s ON s.product_id = p.id AND s.location_id = ?'
      : 'LEFT JOIN inventory_stock s ON s.product_id = p.id';

    const countParams = [];
    if (locationId) {
      countParams.push(locationId);
    }
    countParams.push(...params);

    const [countRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT p.id
         FROM products p
         INNER JOIN categories c ON c.id = p.category_id
         ${joinOnStock}
         ${whereSql}
         GROUP BY p.id
       ) product_rows`,
      countParams
    );
    const total = Number(countRows?.[0]?.total || 0);

    const rowParams = [...params];

    const [rows] = await connection.execute(
      `SELECT
         p.id,
         p.sku,
         p.name,
         p.description,
         p.unit,
         p.price,
         c.id AS category_id,
         c.name AS category_name,
         ${locationId ? '? AS location_id' : 'NULL AS location_id'},
         ${locationId ? '(SELECT name FROM locations WHERE id = ? LIMIT 1) AS location_name' : 'NULL AS location_name'},
         COALESCE(SUM(s.qty_on_hand), 0) AS qty_on_hand,
         COALESCE(SUM(s.qty_reserved), 0) AS qty_reserved,
         COALESCE(SUM(s.qty_on_hand), 0) - COALESCE(SUM(s.qty_reserved), 0) AS qty_available
       FROM products p
       INNER JOIN categories c ON c.id = p.category_id
       ${joinOnStock}
       ${whereSql}
       GROUP BY p.id, p.sku, p.name, p.description, p.unit, p.price, c.id, c.name
       ORDER BY
         qty_available DESC,
         p.name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      [
        ...(locationId ? [locationId, locationId, locationId] : []),
        ...rowParams
      ]
    );

    const appliedLocation = locationId ? await fetchLocationById(connection, locationId) : null;

    res.set('Cache-Control', 'no-store');
    return res.json({
      page,
      limit,
      total,
      hasMore: offset + (Array.isArray(rows) ? rows.length : 0) < total,
      appliedLocation: appliedLocation
        ? {
            id: Number(appliedLocation.id),
            code: String(appliedLocation.code),
            name: String(appliedLocation.name),
            locationType: String(appliedLocation.location_type)
          }
        : null,
      products: (Array.isArray(rows) ? rows : []).map(mapPublicProductRow)
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load shop products.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

shopRouter.post('/public/orders', async (req, res) => {
  const customerName = normalizeText(req.body?.customerName, 120);
  const mobileNumber = normalizeText(req.body?.mobileNumber, 30);
  const fulfillmentMethod = normalizeText(req.body?.fulfillmentMethod, 20).toLowerCase() || 'pickup';
  const deliveryAddress = normalizeText(req.body?.deliveryAddress, 255);
  const notes = normalizeText(req.body?.notes, 255);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const customerAuth = tryParseCustomerAuth(req);

  if (!customerName || !mobileNumber) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Customer name and mobile number are required.'
    });
  }

  if (!['pickup', 'delivery'].includes(fulfillmentMethod)) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'fulfillmentMethod must be pickup or delivery.'
    });
  }

  if (fulfillmentMethod === 'delivery' && !deliveryAddress) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Delivery address is required for delivery orders.'
    });
  }

  if (items.length === 0) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'At least one order item is required.'
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const orderNo = await generateOrderReference(connection);

    const [insertResult] = await connection.execute(
      `INSERT INTO customer_orders (
         order_no,
         customer_user_id,
         customer_name,
         mobile_number,
         fulfillment_method,
         delivery_address,
         notes,
         total_amount,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending')`,
      [
        orderNo,
        customerAuth?.userId ?? null,
        customerName,
        mobileNumber,
        fulfillmentMethod,
        fulfillmentMethod === 'delivery' ? deliveryAddress : null,
        notes || null
      ]
    );

    const orderId = Number(insertResult.insertId);
    let totalAmount = 0;

    for (const rawItem of items) {
      const productId = parseOptionalId(rawItem?.productId);
      const locationId = parseOptionalId(rawItem?.locationId);
      const quantity = Number(rawItem?.quantity ?? 0);

      if (!productId || !locationId || !Number.isInteger(quantity) || quantity <= 0) {
        await connection.rollback();
        return res.status(400).json({
          error: 'INVALID_INPUT',
          message: 'Each order item requires productId, locationId, and a positive integer quantity.'
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
      const currentOnHand = Number(stockRow.qty_on_hand || 0);
      const currentReserved = Number(stockRow.qty_reserved || 0);
      const currentAvailable = currentOnHand - currentReserved;

      if (currentAvailable < quantity) {
        await connection.rollback();
        return res.status(409).json({
          error: 'INSUFFICIENT_STOCK',
          message: `${product.name} only has ${currentAvailable} item(s) available right now.`
        });
      }

      await connection.execute(
        `UPDATE inventory_stock
         SET qty_reserved = ?
         WHERE product_id = ? AND location_id = ?`,
        [currentReserved + quantity, productId, locationId]
      );

      const unitPrice = Number(product.price || 0);
      totalAmount += unitPrice * quantity;

      await connection.execute(
        `INSERT INTO customer_order_items (order_id, product_id, location_id, quantity, unit_price)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, productId, locationId, quantity, unitPrice]
      );
    }

    const roundedTotalAmount = Number(totalAmount.toFixed(2));
    await connection.execute(
      `UPDATE customer_orders
       SET total_amount = ?
       WHERE id = ?`,
      [roundedTotalAmount, orderId]
    );

    req.auth = customerAuth ? { sub: customerAuth.userId, role: 'customer' } : req.auth;
    await writeAuditLog(connection, req, {
      action: 'CUSTOMER_ORDER_CREATE',
      entityType: 'customer_order',
      entityId: orderId,
      afterState: {
        id: orderId,
        order_no: orderNo,
        customer_name: customerName,
        mobile_number: mobileNumber,
        fulfillment_method: fulfillmentMethod,
        total_amount: roundedTotalAmount,
        status: 'pending'
      }
    });

    await connection.commit();
    res.set('Cache-Control', 'no-store');
    return res.status(201).json({
      order: {
        id: orderId,
        orderNo,
        customerName,
        mobileNumber,
        fulfillmentMethod,
        totalAmount: roundedTotalAmount,
        itemCount: items.length,
        status: 'pending'
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'Failed to place order.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

shopRouter.get('/orders', requireAuth, requireRole('admin'), async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1, 50000);
  const limit = parsePositiveInt(req.query.limit, 10, 100);
  const offset = (page - 1) * limit;
  const status = normalizeText(req.query.status, 30).toLowerCase();
  const search = normalizeText(req.query.search, 120);

  const whereClauses = [];
  const params = [];

  if (status) {
    whereClauses.push('o.status = ?');
    params.push(status);
  }

  if (search) {
    whereClauses.push('(o.order_no LIKE ? OR o.customer_name LIKE ? OR o.mobile_number LIKE ?)');
    const searchLike = `%${search}%`;
    params.push(searchLike, searchLike, searchLike);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM customer_orders o
       ${whereSql}`,
      params
    );
    const total = Number(countRows?.[0]?.total || 0);

    const [rows] = await pool.execute(
      `SELECT
         o.id,
         o.order_no,
         o.customer_name,
         o.mobile_number,
         o.fulfillment_method,
         o.delivery_address,
         o.notes,
         o.total_amount,
         o.status,
         o.created_at,
         o.updated_at,
         COUNT(oi.id) AS item_count,
         COALESCE(SUM(oi.quantity), 0) AS total_quantity
       FROM customer_orders o
       LEFT JOIN customer_order_items oi ON oi.order_id = o.id
       ${whereSql}
       GROUP BY
         o.id,
         o.order_no,
         o.customer_name,
         o.mobile_number,
         o.fulfillment_method,
         o.delivery_address,
         o.notes,
         o.total_amount,
         o.status,
         o.created_at,
         o.updated_at
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      page,
      limit,
      total,
      hasMore: offset + (Array.isArray(rows) ? rows.length : 0) < total,
      orders: (Array.isArray(rows) ? rows : []).map(row => ({
        id: Number(row.id),
        orderNo: String(row.order_no),
        customerName: String(row.customer_name),
        mobileNumber: String(row.mobile_number),
        fulfillmentMethod: String(row.fulfillment_method),
        deliveryAddress: row.delivery_address ? String(row.delivery_address) : '',
        notes: row.notes ? String(row.notes) : '',
        totalAmount: Number(row.total_amount || 0),
        status: String(row.status),
        itemCount: Number(row.item_count || 0),
        totalQuantity: Number(row.total_quantity || 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load customer orders.');
  }
});

shopRouter.get('/orders/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const orderId = parseOptionalId(req.params.id);

  if (!orderId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid order id is required.' });
  }

  try {
    const [orderRows] = await pool.execute(
      `SELECT
         o.id,
         o.order_no,
         o.customer_name,
         o.mobile_number,
         o.fulfillment_method,
         o.delivery_address,
         o.notes,
         o.total_amount,
         o.status,
         o.created_at,
         o.updated_at
       FROM customer_orders o
       WHERE o.id = ?
       LIMIT 1`,
      [orderId]
    );

    if (!Array.isArray(orderRows) || orderRows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
    }

    const [itemRows] = await pool.execute(
      `SELECT
         oi.id,
         oi.product_id,
         p.name AS product_name,
         p.sku,
         oi.location_id,
         l.name AS location_name,
         oi.quantity,
         oi.unit_price,
         oi.line_total
       FROM customer_order_items oi
       INNER JOIN products p ON p.id = oi.product_id
       INNER JOIN locations l ON l.id = oi.location_id
       WHERE oi.order_id = ?
       ORDER BY oi.id ASC`,
      [orderId]
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      order: {
        id: Number(orderRows[0].id),
        orderNo: String(orderRows[0].order_no),
        customerName: String(orderRows[0].customer_name),
        mobileNumber: String(orderRows[0].mobile_number),
        fulfillmentMethod: String(orderRows[0].fulfillment_method),
        deliveryAddress: orderRows[0].delivery_address ? String(orderRows[0].delivery_address) : '',
        notes: orderRows[0].notes ? String(orderRows[0].notes) : '',
        totalAmount: Number(orderRows[0].total_amount || 0),
        status: String(orderRows[0].status),
        createdAt: orderRows[0].created_at,
        updatedAt: orderRows[0].updated_at,
        items: (Array.isArray(itemRows) ? itemRows : []).map(row => ({
          id: Number(row.id),
          productId: Number(row.product_id),
          productName: String(row.product_name),
          sku: String(row.sku),
          locationId: Number(row.location_id),
          locationName: String(row.location_name),
          quantity: Number(row.quantity || 0),
          unitPrice: Number(row.unit_price || 0),
          lineTotal: Number(row.line_total || 0)
        }))
      }
    });
  } catch (error) {
    return sendDatabaseError(res, error, 'Failed to load order details.');
  }
});

shopRouter.patch('/orders/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  const orderId = parseOptionalId(req.params.id);
  const action = normalizeText(req.body?.action, 30).toLowerCase();

  if (!orderId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid order id is required.' });
  }

  if (!['approve', 'fulfill', 'cancel'].includes(action)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'action must be approve, fulfill, or cancel.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [orderRows] = await connection.execute(
      `SELECT
         id,
         order_no,
         customer_name,
         mobile_number,
         fulfillment_method,
         delivery_address,
         notes,
         total_amount,
         status
       FROM customer_orders
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [orderId]
    );

    if (!Array.isArray(orderRows) || orderRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
    }

    const order = orderRows[0];
    const currentStatus = String(order.status || '').toLowerCase();

    if (action === 'approve') {
      if (currentStatus !== 'pending') {
        await connection.rollback();
        return res.status(409).json({
          error: 'INVALID_ORDER_STATUS',
          message: 'Only pending orders can be approved.'
        });
      }

      await connection.execute(
        `UPDATE customer_orders
         SET status = 'approved',
             approved_by_user_id = ?,
             approved_at = NOW()
         WHERE id = ?`,
        [req.auth.sub, orderId]
      );
    }

    if (action === 'cancel') {
      if (!['pending', 'approved'].includes(currentStatus)) {
        await connection.rollback();
        return res.status(409).json({
          error: 'INVALID_ORDER_STATUS',
          message: 'Only pending or approved orders can be cancelled.'
        });
      }

      await restoreOrderReservations(connection, orderId);
      await connection.execute(
        `UPDATE customer_orders
         SET status = 'cancelled',
             cancelled_by_user_id = ?,
             cancelled_at = NOW()
         WHERE id = ?`,
        [req.auth.sub, orderId]
      );
    }

    if (action === 'fulfill') {
      if (!['pending', 'approved'].includes(currentStatus)) {
        await connection.rollback();
        return res.status(409).json({
          error: 'INVALID_ORDER_STATUS',
          message: 'Only pending or approved orders can be fulfilled.'
        });
      }

      await fulfillOrderInventory(connection, orderId, String(order.order_no || ''), Number(req.auth.sub));
      await connection.execute(
        `UPDATE customer_orders
         SET status = 'fulfilled',
             approved_by_user_id = COALESCE(approved_by_user_id, ?),
             approved_at = COALESCE(approved_at, NOW()),
             fulfilled_by_user_id = ?,
             fulfilled_at = NOW()
         WHERE id = ?`,
        [req.auth.sub, req.auth.sub, orderId]
      );
    }

    await writeAuditLog(connection, req, {
      action: `CUSTOMER_ORDER_${action.toUpperCase()}`,
      entityType: 'customer_order',
      entityId: orderId,
      beforeState: order,
      afterState: { ...order, status: action === 'approve' ? 'approved' : action === 'cancel' ? 'cancelled' : 'fulfilled' }
    });

    await connection.commit();

    const [updatedRows] = await pool.execute(
      `SELECT
         o.id,
         o.order_no,
         o.customer_name,
         o.mobile_number,
         o.fulfillment_method,
         o.delivery_address,
         o.notes,
         o.total_amount,
         o.status,
         o.created_at,
         o.updated_at,
         COUNT(oi.id) AS item_count
       FROM customer_orders o
       LEFT JOIN customer_order_items oi ON oi.order_id = o.id
       WHERE o.id = ?
       GROUP BY
         o.id,
         o.order_no,
         o.customer_name,
         o.mobile_number,
         o.fulfillment_method,
         o.delivery_address,
         o.notes,
         o.total_amount,
         o.status,
         o.created_at,
         o.updated_at
       LIMIT 1`,
      [orderId]
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      order: {
        id: Number(updatedRows?.[0]?.id || orderId),
        orderNo: String(updatedRows?.[0]?.order_no || order.order_no || ''),
        customerName: String(updatedRows?.[0]?.customer_name || order.customer_name || ''),
        mobileNumber: String(updatedRows?.[0]?.mobile_number || order.mobile_number || ''),
        fulfillmentMethod: String(updatedRows?.[0]?.fulfillment_method || order.fulfillment_method || 'pickup'),
        deliveryAddress: updatedRows?.[0]?.delivery_address ? String(updatedRows[0].delivery_address) : '',
        notes: updatedRows?.[0]?.notes ? String(updatedRows[0].notes) : '',
        totalAmount: Number(updatedRows?.[0]?.total_amount || order.total_amount || 0),
        status: String(updatedRows?.[0]?.status || action),
        itemCount: Number(updatedRows?.[0]?.item_count || 0),
        createdAt: updatedRows?.[0]?.created_at || null,
        updatedAt: updatedRows?.[0]?.updated_at || null
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        error: error.errorCode || 'ORDER_STATUS_ERROR',
        message: error.message || 'Failed to update customer order.'
      });
    }

    return sendDatabaseError(res, error, 'Failed to update customer order.');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

module.exports = { shopRouter };
