-- Core schema for Hospital Inventory Management (Phase 1)
-- Database selection is handled by api/scripts/init-db.js

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(120) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  avatar_path VARCHAR(255) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'employee', 'customer') NOT NULL DEFAULT 'employee',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @users_has_avatar_path = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'avatar_path'
);
SET @sql_users_avatar_path = IF(
  @users_has_avatar_path = 0,
  'ALTER TABLE users ADD COLUMN avatar_path VARCHAR(255) NULL AFTER full_name',
  'SELECT 1'
);
PREPARE stmt_users_avatar_path FROM @sql_users_avatar_path;
EXECUTE stmt_users_avatar_path;
DEALLOCATE PREPARE stmt_users_avatar_path;

SET @users_has_customer_role = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'role'
);
SET @sql_users_customer_role = IF(
  @users_has_customer_role = 1,
  'ALTER TABLE users MODIFY COLUMN role ENUM(''admin'', ''employee'', ''customer'') NOT NULL DEFAULT ''employee''',
  'SELECT 1'
);
PREPARE stmt_users_customer_role FROM @sql_users_customer_role;
EXECUTE stmt_users_customer_role;
DEALLOCATE PREPARE stmt_users_customer_role;

CREATE TABLE IF NOT EXISTS login_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  username VARCHAR(50) NOT NULL,
  success TINYINT(1) NOT NULL DEFAULT 0,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_login_logs_username_created (username, created_at),
  KEY idx_login_logs_success_created (success, created_at),
  KEY idx_login_logs_user_created (user_id, created_at),
  CONSTRAINT fk_login_logs_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id BIGINT UNSIGNED NOT NULL,
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(255) NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'unit',
  price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  reorder_level INT UNSIGNED NOT NULL DEFAULT 0,
  controlled_flag TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_category (category_id),
  KEY idx_products_name (name),
  CONSTRAINT fk_products_category
    FOREIGN KEY (category_id) REFERENCES categories(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS locations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(120) NOT NULL,
  location_type ENUM('warehouse', 'department', 'pharmacy', 'frontdesk', 'online') NOT NULL DEFAULT 'department',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_locations_code (code),
  UNIQUE KEY uq_locations_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_stock (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  qty_on_hand INT UNSIGNED NOT NULL DEFAULT 0,
  qty_reserved INT UNSIGNED NOT NULL DEFAULT 0,
  last_counted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_product_location (product_id, location_id),
  KEY idx_inventory_location_product (location_id, product_id),
  CONSTRAINT fk_inventory_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_inventory_location
    FOREIGN KEY (location_id) REFERENCES locations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_no VARCHAR(30) NOT NULL,
  sale_channel ENUM('walk_in', 'online') NOT NULL DEFAULT 'walk_in',
  patient_name VARCHAR(120) NULL,
  patient_id VARCHAR(40) NULL,
  total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  payment_method ENUM('cash', 'card') NOT NULL DEFAULT 'cash',
  amount_paid DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  change_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  status ENUM('pending', 'completed', 'cancelled', 'refunded') NOT NULL DEFAULT 'completed',
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_sale_no (sale_no),
  KEY idx_sales_channel_created (sale_channel, created_at),
  KEY idx_sales_status_created (status, created_at),
  CONSTRAINT fk_sales_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS patients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id VARCHAR(40) NULL,
  full_name VARCHAR(120) NULL,
  source ENUM('walk_in', 'online', 'manual') NOT NULL DEFAULT 'walk_in',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_patients_patient_id (patient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_counters (
  counter_date DATE NOT NULL,
  `last_value` INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (counter_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no VARCHAR(30) NOT NULL,
  customer_user_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(120) NOT NULL,
  mobile_number VARCHAR(30) NOT NULL,
  fulfillment_method ENUM('pickup', 'delivery') NOT NULL DEFAULT 'pickup',
  delivery_address VARCHAR(255) NULL,
  notes VARCHAR(255) NULL,
  total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  status ENUM('pending', 'approved', 'fulfilled', 'cancelled') NOT NULL DEFAULT 'pending',
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  fulfilled_by_user_id BIGINT UNSIGNED NULL,
  fulfilled_at DATETIME NULL,
  cancelled_by_user_id BIGINT UNSIGNED NULL,
  cancelled_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_orders_order_no (order_no),
  KEY idx_customer_orders_status_created (status, created_at),
  KEY idx_customer_orders_customer_name (customer_name),
  KEY idx_customer_orders_mobile_number (mobile_number),
  CONSTRAINT fk_customer_orders_customer_user
    FOREIGN KEY (customer_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_customer_orders_approved_by
    FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_customer_orders_fulfilled_by
    FOREIGN KEY (fulfilled_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_customer_orders_cancelled_by
    FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12, 2) NOT NULL,
  line_total DECIMAL(12, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_customer_order_items_order (order_id),
  KEY idx_customer_order_items_product (product_id),
  KEY idx_customer_order_items_location (location_id),
  CONSTRAINT fk_customer_order_items_order
    FOREIGN KEY (order_id) REFERENCES customer_orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_customer_order_items_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_customer_order_items_location
    FOREIGN KEY (location_id) REFERENCES locations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backward-compatible migration for already-created databases.
SET @sales_has_payment_method = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'sales' AND column_name = 'payment_method'
);
SET @sql_sales_payment_method = IF(
  @sales_has_payment_method = 0,
  'ALTER TABLE sales ADD COLUMN payment_method ENUM(''cash'', ''card'') NOT NULL DEFAULT ''cash''',
  'SELECT 1'
);
PREPARE stmt_sales_payment_method FROM @sql_sales_payment_method;
EXECUTE stmt_sales_payment_method;
DEALLOCATE PREPARE stmt_sales_payment_method;

SET @sales_has_amount_paid = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'sales' AND column_name = 'amount_paid'
);
SET @sql_sales_amount_paid = IF(
  @sales_has_amount_paid = 0,
  'ALTER TABLE sales ADD COLUMN amount_paid DECIMAL(12, 2) NOT NULL DEFAULT 0.00',
  'SELECT 1'
);
PREPARE stmt_sales_amount_paid FROM @sql_sales_amount_paid;
EXECUTE stmt_sales_amount_paid;
DEALLOCATE PREPARE stmt_sales_amount_paid;

SET @sales_has_change_amount = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'sales' AND column_name = 'change_amount'
);
SET @sql_sales_change_amount = IF(
  @sales_has_change_amount = 0,
  'ALTER TABLE sales ADD COLUMN change_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00',
  'SELECT 1'
);
PREPARE stmt_sales_change_amount FROM @sql_sales_change_amount;
EXECUTE stmt_sales_change_amount;
DEALLOCATE PREPARE stmt_sales_change_amount;

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12, 2) NOT NULL,
  line_total DECIMAL(12, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sale_items_sale (sale_id),
  KEY idx_sale_items_product (product_id),
  KEY idx_sale_items_location (location_id),
  CONSTRAINT fk_sale_items_sale
    FOREIGN KEY (sale_id) REFERENCES sales(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sale_items_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_sale_items_location
    FOREIGN KEY (location_id) REFERENCES locations(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS patient_issues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  issue_no VARCHAR(30) NOT NULL,
  patient_name VARCHAR(120) NOT NULL,
  patient_id VARCHAR(40) NULL,
  department VARCHAR(120) NOT NULL,
  status ENUM('issued', 'cancelled') NOT NULL DEFAULT 'issued',
  issued_by_user_id BIGINT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_patient_issues_issue_no (issue_no),
  KEY idx_patient_issues_department_created (department, created_at),
  KEY idx_patient_issues_status_created (status, created_at),
  CONSTRAINT fk_patient_issues_issued_by
    FOREIGN KEY (issued_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS issue_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_issue_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NULL,
  quantity INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_issue_items_issue (patient_issue_id),
  KEY idx_issue_items_product (product_id),
  KEY idx_issue_items_location (location_id),
  CONSTRAINT fk_issue_items_issue
    FOREIGN KEY (patient_issue_id) REFERENCES patient_issues(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_issue_items_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_issue_items_location
    FOREIGN KEY (location_id) REFERENCES locations(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NULL,
  movement_type ENUM(
    'RECEIVE',
    'SALE_WALKIN',
    'SALE_ONLINE',
    'PATIENT_ISSUE',
    'RETURN',
    'ADJUSTMENT_IN',
    'ADJUSTMENT_OUT',
    'TRANSFER_OUT',
    'TRANSFER_IN'
  ) NOT NULL,
  quantity INT NOT NULL,
  unit_cost DECIMAL(12, 2) NULL,
  reference_type ENUM('purchase_receipt', 'sale', 'patient_issue', 'adjustment', 'transfer', 'return', 'manual', 'customer_order') NOT NULL DEFAULT 'manual',
  reference_id BIGINT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_stock_movements_product_created (product_id, created_at),
  KEY idx_stock_movements_location_created (location_id, created_at),
  KEY idx_stock_movements_type_created (movement_type, created_at),
  KEY idx_stock_movements_reference (reference_type, reference_id),
  CONSTRAINT fk_stock_movements_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_stock_movements_location
    FOREIGN KEY (location_id) REFERENCES locations(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_stock_movements_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @stock_movements_has_customer_order_reference = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'stock_movements' AND column_name = 'reference_type'
);
SET @sql_stock_movements_customer_order_reference = IF(
  @stock_movements_has_customer_order_reference = 1,
  'ALTER TABLE stock_movements MODIFY COLUMN reference_type ENUM(''purchase_receipt'', ''sale'', ''patient_issue'', ''adjustment'', ''transfer'', ''return'', ''manual'', ''customer_order'') NOT NULL DEFAULT ''manual''',
  'SELECT 1'
);
PREPARE stmt_stock_movements_customer_order_reference FROM @sql_stock_movements_customer_order_reference;
EXECUTE stmt_stock_movements_customer_order_reference;
DEALLOCATE PREPARE stmt_stock_movements_customer_order_reference;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NULL,
  before_state JSON NULL,
  after_state JSON NULL,
  meta JSON NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_logs_actor_created (actor_user_id, created_at),
  KEY idx_audit_logs_entity_created (entity_type, created_at),
  KEY idx_audit_logs_action_created (action, created_at),
  CONSTRAINT fk_audit_logs_actor
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW vw_product_stock_summary AS
SELECT
  p.id AS product_id,
  p.sku,
  p.name AS product_name,
  c.name AS category_name,
  p.unit,
  p.price,
  p.reorder_level,
  COALESCE(SUM(s.qty_on_hand), 0) AS qty_on_hand,
  COALESCE(SUM(s.qty_reserved), 0) AS qty_reserved,
  COALESCE(SUM(s.qty_on_hand), 0) - COALESCE(SUM(s.qty_reserved), 0) AS qty_available
FROM products p
INNER JOIN categories c ON c.id = p.category_id
LEFT JOIN inventory_stock s ON s.product_id = p.id
GROUP BY p.id, p.sku, p.name, c.name, p.unit, p.price, p.reorder_level;
