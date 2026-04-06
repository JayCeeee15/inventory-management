# Auth API (Express + MySQL)

## 1) Configure environment

Create `.env` in project root (copy from `.env.example`) and set:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `JWT_SECRET`

## 2) Initialize database

```bash
npm run db:init
```

This creates database schema and seeds:

- `admin / admin123`
- `user / user123`
- categories
- locations
- products
- inventory stock

If you already have the exported hospital MySQL dump, use the project-local dump folder instead:

```bash
npm run db:import:hospital
```

The dump files live in `api/sql/hospital_inventory`. Set `DB_NAME` in `.env` to the database you want to import into, such as `hospital_inventory`.

Core tables created:

- `users`, `login_logs`
- `categories`, `products`, `locations`, `inventory_stock`
- `sales`, `sale_items`
- `patient_issues`, `issue_items`
- `stock_movements`, `audit_logs`
- view: `vw_product_stock_summary`

## 3) Run app

```bash
npm run serve:all
```

This starts:

- Auth API on `http://localhost:3001/api`
- json-server for inventory data on `http://localhost:3000`
- Angular app on `http://localhost:4200`

## 4) Inventory API endpoints (Step 2)

All endpoints below require `Authorization: Bearer <token>`.

- `GET /api/inventory/categories`
- `GET /api/inventory/categories/:id`
- `POST /api/inventory/categories` (admin)
- `PUT /api/inventory/categories/:id` (admin)
- `DELETE /api/inventory/categories/:id` (admin, soft archive)
- `GET /api/inventory/locations`
- `GET /api/inventory/products`
- `GET /api/inventory/products/:id`
- `POST /api/inventory/products` (admin)
- `PUT /api/inventory/products/:id` (admin)
- `DELETE /api/inventory/products/:id` (admin, soft archive)
- `POST /api/inventory/stock/receive` (admin)
- `POST /api/inventory/stock/adjust` (admin)
- `POST /api/inventory/sales` (walk-in or online stock deduction with `paymentMethod`, `amountPaid`, `changeAmount`)
- `POST /api/inventory/patient-issues` (patient dispensing stock deduction)
- `GET /api/inventory/stock/movements`
- `GET /api/inventory/dashboard/summary`
