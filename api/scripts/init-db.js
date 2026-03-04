const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true
};

const dbName = process.env.DB_NAME || 'inventory_management';

const seedCategories = [
  { name: 'Emergency Medicines', description: 'Fast-access drugs for emergency use.' },
  { name: 'Pharmacy Stock', description: 'General pharmacy inventory and daily dispensed medicines.' },
  { name: 'Ward Consumables', description: 'Ward-level supplies for inpatient care.' },
  { name: 'Surgical Supplies', description: 'Consumables and tools used in OR and procedures.' },
  { name: 'Laboratory Kits', description: 'Reagents, kits, and sample handling items.' },
  { name: 'PPE & Safety', description: 'Personal protective equipment and safety items.' },
  { name: 'Cold-Chain Items', description: 'Temperature-sensitive vaccines and medicines.' }
];

const seedLocations = [
  { code: 'MAIN-WH', name: 'Main Warehouse', locationType: 'warehouse' },
  { code: 'PHARM', name: 'Hospital Pharmacy', locationType: 'pharmacy' },
  { code: 'WALKIN', name: 'Walk-in Counter', locationType: 'frontdesk' },
  { code: 'ONLINE', name: 'Online Fulfillment', locationType: 'online' }
];

const seedProducts = [
  {
    sku: 'MED-PARA-500',
    name: 'Paracetamol 500mg',
    category: 'Pharmacy Stock',
    unit: 'box',
    price: 4.5,
    reorderLevel: 80,
    qtyByLocation: { PHARM: 300, WALKIN: 80, ONLINE: 60 }
  },
  {
    sku: 'MED-AMOX-500',
    name: 'Amoxicillin 500mg',
    category: 'Emergency Medicines',
    unit: 'box',
    price: 12.75,
    reorderLevel: 50,
    qtyByLocation: { PHARM: 180, WALKIN: 40, ONLINE: 25 }
  },
  {
    sku: 'SUP-IVCAN-22',
    name: 'IV Cannula 22G',
    category: 'Ward Consumables',
    unit: 'pack',
    price: 19.0,
    reorderLevel: 35,
    qtyByLocation: { PHARM: 120, WALKIN: 30 }
  },
  {
    sku: 'PPE-N95-BOX',
    name: 'N95 Respirator',
    category: 'PPE & Safety',
    unit: 'box',
    price: 13.0,
    reorderLevel: 30,
    qtyByLocation: { PHARM: 90, WALKIN: 20, ONLINE: 15 }
  },
  {
    sku: 'SURG-GLV-M',
    name: 'Surgical Gloves Medium',
    category: 'Surgical Supplies',
    unit: 'box',
    price: 9.2,
    reorderLevel: 40,
    qtyByLocation: { PHARM: 140, WALKIN: 45 }
  }
];

async function loadSchemaSql() {
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  return fs.readFileSync(schemaPath, 'utf8');
}

async function seedUsers(connection) {
  const adminHash = await bcrypt.hash('admin123', 12);
  const employeeHash = await bcrypt.hash('user123', 12);

  await connection.execute(
    `INSERT INTO users (username, email, full_name, password_hash, role, is_active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       full_name = VALUES(full_name),
       password_hash = VALUES(password_hash),
       role = VALUES(role),
       is_active = VALUES(is_active)`,
    ['admin', 'admin@local.hms', 'System Admin', adminHash, 'admin', 1]
  );

  await connection.execute(
    `INSERT INTO users (username, email, full_name, password_hash, role, is_active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       full_name = VALUES(full_name),
       password_hash = VALUES(password_hash),
       role = VALUES(role),
       is_active = VALUES(is_active)`,
    ['user', 'user@local.hms', 'Hospital Staff', employeeHash, 'employee', 1]
  );
}

async function seedCategoriesAndLocations(connection) {
  for (const item of seedCategories) {
    await connection.execute(
      `INSERT INTO categories (name, description, is_active)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE
         description = VALUES(description),
         is_active = VALUES(is_active)`,
      [item.name, item.description]
    );
  }

  for (const item of seedLocations) {
    await connection.execute(
      `INSERT INTO locations (code, name, location_type, is_active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         location_type = VALUES(location_type),
         is_active = VALUES(is_active)`,
      [item.code, item.name, item.locationType]
    );
  }
}

async function fetchCategoryMap(connection) {
  const [rows] = await connection.query('SELECT id, name FROM categories');
  const categoryMap = new Map();
  for (const row of rows) {
    categoryMap.set(String(row.name), Number(row.id));
  }
  return categoryMap;
}

async function fetchLocationMap(connection) {
  const [rows] = await connection.query('SELECT id, code FROM locations');
  const locationMap = new Map();
  for (const row of rows) {
    locationMap.set(String(row.code), Number(row.id));
  }
  return locationMap;
}

async function seedProductsAndStock(connection, categoryMap, locationMap) {
  for (const product of seedProducts) {
    const categoryId = categoryMap.get(product.category);
    if (!categoryId) {
      throw new Error(`Missing category for product seed: ${product.category}`);
    }

    await connection.execute(
      `INSERT INTO products (category_id, sku, name, unit, price, reorder_level, controlled_flag, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1)
       ON DUPLICATE KEY UPDATE
         category_id = VALUES(category_id),
         name = VALUES(name),
         unit = VALUES(unit),
         price = VALUES(price),
         reorder_level = VALUES(reorder_level),
         controlled_flag = VALUES(controlled_flag),
         is_active = VALUES(is_active)`,
      [categoryId, product.sku, product.name, product.unit, product.price, product.reorderLevel]
    );
  }

  const [productRows] = await connection.query('SELECT id, sku FROM products');
  const productMap = new Map();
  for (const row of productRows) {
    productMap.set(String(row.sku), Number(row.id));
  }

  for (const product of seedProducts) {
    const productId = productMap.get(product.sku);
    if (!productId) {
      continue;
    }

    for (const [locationCode, quantity] of Object.entries(product.qtyByLocation)) {
      const locationId = locationMap.get(locationCode);
      if (!locationId) {
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
    }
  }
}

async function run() {
  let connection;

  try {
    connection = await mysql.createConnection(config);
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${dbName}\``);

    const schemaSql = await loadSchemaSql();
    await connection.query(schemaSql);

    await seedUsers(connection);
    await seedCategoriesAndLocations(connection);

    const categoryMap = await fetchCategoryMap(connection);
    const locationMap = await fetchLocationMap(connection);
    await seedProductsAndStock(connection, categoryMap, locationMap);

    console.log(`Database '${dbName}' initialized successfully.`);
    console.log('Seed users ready: admin/admin123 and user/user123');
    console.log('Seed master data ready: categories, locations, products, and stock.');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

run();
