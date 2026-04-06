-- Hospital Inventory starter queries for MySQL Workbench
-- Open this file in Workbench, then run the queries one by one.

USE hospital_inventory;

-- Query 1: Show all tables and views in the database
SHOW FULL TABLES;

-- Query 2: Show all users
SELECT
  id,
  username,
  email,
  full_name,
  role,
  is_active,
  created_at
FROM users
ORDER BY id;

-- Query 3: Show product list with category
SELECT
  p.id,
  p.sku,
  p.name AS product_name,
  c.name AS category_name,
  p.unit,
  p.price,
  p.reorder_level,
  p.is_active
FROM products p
JOIN categories c ON c.id = p.category_id
ORDER BY p.id;

-- Query 4: Show stock per product using the view
SELECT
  product_id,
  sku,
  product_name,
  category_name,
  unit,
  price,
  reorder_level,
  qty_on_hand,
  qty_reserved,
  qty_available
FROM vw_product_stock_summary
ORDER BY product_name;

-- Query 5: Show inventory stock by location
SELECT
  l.code AS location_code,
  l.name AS location_name,
  p.sku,
  p.name AS product_name,
  s.qty_on_hand,
  s.qty_reserved,
  (s.qty_on_hand - s.qty_reserved) AS qty_available
FROM inventory_stock s
JOIN products p ON p.id = s.product_id
JOIN locations l ON l.id = s.location_id
ORDER BY l.name, p.name;

-- Query 6: Show recent sales with totals
SELECT
  id,
  sale_no,
  sale_channel,
  patient_name,
  total_amount,
  payment_method,
  status,
  created_at
FROM sales
ORDER BY created_at DESC;

-- Query 7: Show sales with item details
SELECT
  s.sale_no,
  s.created_at,
  p.sku,
  p.name AS product_name,
  si.quantity,
  si.unit_price,
  si.line_total
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
JOIN products p ON p.id = si.product_id
ORDER BY s.created_at DESC, s.sale_no, p.name;

-- Query 8: Show patient issues and issued items
SELECT
  pi.issue_no,
  pi.patient_name,
  pi.patient_id,
  pi.status,
  pi.created_at,
  p.sku,
  p.name AS product_name,
  ii.quantity,
  ii.unit_price,
  ii.line_total
FROM patient_issues pi
JOIN issue_items ii ON ii.patient_issue_id = pi.id
JOIN products p ON p.id = ii.product_id
ORDER BY pi.created_at DESC, pi.issue_no, p.name;

-- Query 9: Show stock movement history
SELECT
  sm.id,
  sm.movement_type,
  p.sku,
  p.name AS product_name,
  l.name AS location_name,
  sm.quantity,
  sm.reference_type,
  sm.reference_no,
  sm.notes,
  sm.created_at
FROM stock_movements sm
JOIN products p ON p.id = sm.product_id
LEFT JOIN locations l ON l.id = sm.location_id
ORDER BY sm.created_at DESC, sm.id DESC;

-- Query 10: Show low-stock products
SELECT
  v.product_id,
  v.sku,
  v.product_name,
  v.category_name,
  v.reorder_level,
  v.qty_available
FROM vw_product_stock_summary v
WHERE v.qty_available <= v.reorder_level
ORDER BY v.qty_available ASC, v.product_name;

-- Query 11: Show login logs
SELECT
  id,
  user_id,
  username,
  success,
  ip,
  created_at
FROM login_logs
ORDER BY created_at DESC
LIMIT 100;

-- Query 12: Show audit logs
SELECT
  id,
  actor_user_id,
  action,
  entity_type,
  entity_id,
  created_at
FROM audit_logs
ORDER BY created_at DESC
LIMIT 100;

-- Query 13: User activity timeline (sign up, login, buy product)
SELECT
  activity.user_id,
  activity.username,
  activity.full_name,
  activity.role,
  activity.activity_type,
  activity.activity_time,
  activity.reference_no,
  activity.product_sku,
  activity.product_name,
  activity.quantity,
  activity.amount,
  activity.details
FROM (
  SELECT
    u.id AS user_id,
    u.username,
    u.full_name,
    u.role,
    'SIGN_UP' AS activity_type,
    u.created_at AS activity_time,
    NULL AS reference_no,
    NULL AS product_sku,
    NULL AS product_name,
    NULL AS quantity,
    NULL AS amount,
    'Account created' AS details
  FROM users u

  UNION ALL

  SELECT
    COALESCE(ll.user_id, u.id) AS user_id,
    COALESCE(u.username, ll.username) AS username,
    u.full_name,
    COALESCE(u.role, 'unknown') AS role,
    CASE WHEN ll.success = 1 THEN 'LOGIN_SUCCESS' ELSE 'LOGIN_FAILED' END AS activity_type,
    ll.created_at AS activity_time,
    CONCAT('LOGIN-', ll.id) AS reference_no,
    NULL AS product_sku,
    NULL AS product_name,
    NULL AS quantity,
    NULL AS amount,
    CONCAT('IP: ', COALESCE(ll.ip, 'n/a')) AS details
  FROM login_logs ll
  LEFT JOIN users u
    ON u.id = ll.user_id

  UNION ALL

  SELECT
    co.customer_user_id AS user_id,
    u.username,
    u.full_name,
    u.role,
    'BUY_PRODUCT' AS activity_type,
    co.created_at AS activity_time,
    co.order_no AS reference_no,
    p.sku AS product_sku,
    p.name AS product_name,
    coi.quantity,
    coi.line_total AS amount,
    CONCAT('Order status: ', co.status) AS details
  FROM customer_orders co
  JOIN users u
    ON u.id = co.customer_user_id
  JOIN customer_order_items coi
    ON coi.order_id = co.id
  JOIN products p
    ON p.id = coi.product_id
) activity
ORDER BY activity.activity_time DESC, activity.username;

-- Query 14: Employee logs and actions
SELECT
  logs.employee_id,
  logs.username,
  logs.full_name,
  logs.role,
  logs.log_source,
  logs.activity_time,
  logs.event_name,
  logs.entity_type,
  logs.entity_id,
  logs.ip_address,
  logs.details
FROM (
  SELECT
    u.id AS employee_id,
    u.username,
    u.full_name,
    u.role,
    'LOGIN_LOG' AS log_source,
    ll.created_at AS activity_time,
    CASE WHEN ll.success = 1 THEN 'LOGIN_SUCCESS' ELSE 'LOGIN_FAILED' END AS event_name,
    NULL AS entity_type,
    NULL AS entity_id,
    ll.ip AS ip_address,
    ll.user_agent AS details
  FROM login_logs ll
  JOIN users u
    ON u.id = ll.user_id
  WHERE u.role IN ('admin', 'employee')

  UNION ALL

  SELECT
    u.id AS employee_id,
    u.username,
    u.full_name,
    u.role,
    'AUDIT_LOG' AS log_source,
    al.created_at AS activity_time,
    al.action AS event_name,
    al.entity_type,
    al.entity_id,
    al.ip AS ip_address,
    JSON_UNQUOTE(JSON_EXTRACT(al.after_state, '$.sale_no')) AS details
  FROM audit_logs al
  JOIN users u
    ON u.id = al.actor_user_id
  WHERE u.role IN ('admin', 'employee')
) logs
ORDER BY logs.activity_time DESC, logs.username;
