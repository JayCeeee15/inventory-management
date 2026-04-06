This folder contains the MySQL hospital inventory dump that was copied from:

`C:\Users\malig\Downloads\hospital_inventory\hospital+inventory`

Use this folder as the project-owned location for the database dump instead of importing from `Downloads`.

Import flow:

1. Copy `.env.example` to `.env`.
2. Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.
3. Run `npm run db:import:hospital`.

Notes:

- The import uses the database name from `.env`.
- If you want to keep the original dump database name, set `DB_NAME=hospital_inventory`.
- The dump files contain `DROP TABLE IF EXISTS`, so importing will replace the dumped tables in the target database.
- The import order is handled by `api/scripts/import-hospital-dump.js`.
