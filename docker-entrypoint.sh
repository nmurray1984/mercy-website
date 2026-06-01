#!/bin/sh
set -e

# Everything that must survive restarts/deploys lives on the mounted Fly volume
# (/data): the SQLite DB, uploaded images, and the generated public/ site.
# DATABASE_PATH / PUBLIC_DIR / UPLOAD_DIR are set in fly.<env>.toml [env].

# Make sure the upload dir exists before the app or build touches it.
mkdir -p "${UPLOAD_DIR:-/data/public/assets/img/uploads}"

# All three steps are idempotent (verified):
#   - migrate: tracked in schema_migrations, skips applied files
#   - seed:    ON CONFLICT updates metadata only, never overwrites edited values
#   - build:   writes files atomically, never wipes the dir (uploads survive)
echo "[entrypoint] migrating database..."
node db/migrate.js

echo "[entrypoint] seeding content (new keys only)..."
node db/seed-content.js

echo "[entrypoint] building public site..."
node build/build.js

echo "[entrypoint] starting server..."
exec node server/index.js
