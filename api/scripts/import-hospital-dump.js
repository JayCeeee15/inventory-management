const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const dumpDir = path.join(__dirname, '..', 'sql', 'hospital_inventory');
const dbName = process.env.DB_NAME || 'hospital_inventory';
const dryRun = process.argv.includes('--dry-run');

const importOrder = [
  'hospital_inventory_users.sql',
  'hospital_inventory_categories.sql',
  'hospital_inventory_locations.sql',
  'hospital_inventory_patients.sql',
  'hospital_inventory_order_counters.sql',
  'hospital_inventory_products.sql',
  'hospital_inventory_inventory_stock.sql',
  'hospital_inventory_sales.sql',
  'hospital_inventory_sale_items.sql',
  'hospital_inventory_patient_issues.sql',
  'hospital_inventory_issue_items.sql',
  'hospital_inventory_customer_orders.sql',
  'hospital_inventory_customer_order_items.sql',
  'hospital_inventory_stock_movements.sql',
  'hospital_inventory_login_logs.sql',
  'hospital_inventory_audit_logs.sql',
  'hospital_inventory_routines.sql'
];

function sanitizeSql(sql) {
  return sql.replace(/DEFINER=`[^`]+`@`[^`]+`\s+/g, '');
}

function ensureDumpFiles() {
  const missing = importOrder.filter((file) => !fs.existsSync(path.join(dumpDir, file)));

  if (missing.length > 0) {
    throw new Error(
      `Missing SQL dump files in ${dumpDir}: ${missing.join(', ')}`
    );
  }
}

async function run() {
  ensureDumpFiles();

  if (dryRun) {
    console.log(`Dump folder: ${dumpDir}`);
    console.log(`Target database: ${dbName}`);
    console.log('Import order:');
    for (const file of importOrder) {
      console.log(`- ${file}`);
    }
    return;
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${dbName}\``);

    for (const file of importOrder) {
      const filePath = path.join(dumpDir, file);
      const sql = sanitizeSql(fs.readFileSync(filePath, 'utf8'));

      console.log(`Importing ${file}...`);
      await connection.query(sql);
    }

    console.log(`Hospital dump imported successfully into '${dbName}'.`);
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error('Failed to import hospital SQL dump:', error.message);
  process.exitCode = 1;
});
