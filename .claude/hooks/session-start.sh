#!/bin/bash
# SessionStart hook: make a fresh web container runnable.
# Installs deps and ensures a working local dev DB + .env so tests and the app
# work without manual setup. See CLAUDE.md for the equivalent manual steps.
set -euo pipefail
cd "$CLAUDE_PROJECT_DIR"

# Web/remote sessions only; do nothing on a developer's local machine.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

npm install

# Local dev .env. Dev runs over http, so COOKIE_SECURE must be false or the
# session cookie is dropped and admin login fails with "invalid csrf token".
if [ ! -f .env ]; then
  cat > .env <<'ENV'
DATABASE_PATH=./data/mercy.sqlite
PUBLIC_DIR=./public
UPLOAD_DIR=./site/assets/img/uploads
PORT=3000
SESSION_SECRET=local-dev-only-change-me-0123456789abcdef
CSRF_SECRET=local-dev-only-change-me-0123456789abcdef
COOKIE_SECURE=false
TRUST_PROXY=0
LOG_LEVEL=warn
ENV
fi

# Always apply migrations (idempotent; picks up any new ones).
npm run migrate

# First-run only: seed content, build the site, and create a dev admin. Skipped
# when a DB already exists so we never clobber edits made earlier in the session.
if [ ! -s data/mercy.sqlite ] || [ "$(node -e "try{const d=require('better-sqlite3')(process.env.DATABASE_PATH||'data/mercy.sqlite');console.log(d.prepare('SELECT COUNT(*) n FROM content').get().n)}catch(e){console.log(0)}")" = "0" ]; then
  npm run seed
  npm run build
  node bin/create-user.js --email admin@example.com --role superuser --password "localdevpass12345" || true
fi
