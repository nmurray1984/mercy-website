# CLAUDE.md

Operational quick-reference for working in this repo. The human-facing overview
lives in `README.md`; this file is the agent's "how do I actually run, test, and
ship this" cheat sheet.

## What this is

Mercy Presbyterian church website. A **single Node/Express process** serves
three things:

- **Public site** — flat HTML in `public/`, built from Nunjucks templates +
  SQLite content. Node only `sendFile()`s prebuilt files; no per-request render.
- **Admin UI** — server-rendered Nunjucks under `/admin/*` (auth required).
- **JSON API** — under `/api/*` (auth required).

Stack: Express, better-sqlite3, Nunjucks, marked, sharp, multer. No framework,
no ORM, no client build step. Node >= 20.

## Getting to a runnable state (fresh container)

A SessionStart hook (`.claude/hooks/`) normally does this automatically. To do it
by hand:

```bash
npm install
# Create a LOCAL dev .env (http, so COOKIE_SECURE must be false or login breaks):
cat > .env <<'EOF'
DATABASE_PATH=./data/mercy.sqlite
PUBLIC_DIR=./public
UPLOAD_DIR=./site/assets/img/uploads
PORT=3000
SESSION_SECRET=local-dev-only-change-me-0123456789abcdef
CSRF_SECRET=local-dev-only-change-me-0123456789abcdef
COOKIE_SECURE=false
TRUST_PROXY=0
LOG_LEVEL=warn
EOF
npm run migrate     # apply db/migrations/*.sql (idempotent)
npm run seed        # load ~168 content rows
npm run build       # render public/ from the DB
node bin/create-user.js --email admin@example.com --role superuser --password "localdevpass12345"
npm start           # http://127.0.0.1:3000  (admin at /admin)
```

`data/`, `public/`, and `.env` are gitignored — they're per-environment, never
committed.

## Commands

| Task | Command |
|------|---------|
| Run | `npm start` (or `npm run dev` for `--watch`) |
| Build public site from DB | `npm run build` |
| Unit tests | `npm run test:unit` |
| Integration tests | `npm run test:integration` |
| UI tests (Playwright) | `npm run test:ui` — **needs a browser; see gotchas** |
| Migrate / seed | `npm run migrate` / `npm run seed` |
| Create a user | `node bin/create-user.js --email … --role [admin\|superuser]` |

## Content model (the heart of the site)

Editable copy lives in the `content` table: `{ key, value, kind, page, section,
… }`. `kind` is one of `text | markdown | html | image`. Edits are revisioned
(`content_revisions`) and the public site only updates after a **rebuild**.

Templates pull content through Nunjucks filters (`build/render.js`):

- `{{ "key" | t }}` — plain text, HTML-escaped. **Attribute-safe** (use in
  `alt=""`, `<title>`, meta, etc.).
- `{{ "key" | te }}` — like `t`, but inline-editable in the visual editor. Only
  use in element-body context, never in an attribute.
- `{{ "key" | tmd }}` — markdown → HTML.
- `{{ "key" | thtml }}` — raw trusted HTML.
- `{{ "key" | timg }}` — image URL/path (for `src=""`).
- `{{ asset('styles.css') }}` — content-hashed asset URL.

The build flow: `build/build.js` reads `content` + `media` from SQLite, copies
`site/assets/**` (hashing css/js), renders each page in `build/pages.js`, and
writes `public/<url>/index.html`. The admin "Rebuild" button and `POST /api/build`
shell out to the same `build()`.

## In-page visual editor

Admins edit pages in place at **`/admin/edit/:slug`** (`server/editor.js`). It
live-renders the real page with the shared Nunjucks env in `editable: true` mode
(wraps fields in `data-mw-key` markers, collects image keys on `env.mwImages`),
then injects `server/public/edit.{js,css}`. Saves reuse the revisioned
`PUT /api/content/:key`; "Publish" calls `POST /api/build`. The **public build is
never editable** — its output is byte-for-byte unchanged.

## Branches & deploys

- Feature work branches off `develop`. Flow: **feature → `develop` → `main`**.
- Pushing **`develop`** auto-deploys the **dev** Fly app (`.github/workflows/deploy-dev.yml`).
- Pushing **`main`** auto-deploys the **test** Fly app (`deploy-test.yml`).
- **Production** deploys only on a **`v*` git tag** and **pauses for manual
  approval** (`deploy-prod.yml` + the `prod` GitHub environment). Merging to
  `main` does NOT touch prod.
- Do not create PRs unless asked. Push to the assigned feature branch.

## Gotchas

- **Local dev is http**, so `.env` must set `COOKIE_SECURE=false` — otherwise the
  session cookie is dropped and login fails with "invalid csrf token".
- **Playwright can't download Chromium in the web sandbox** (network policy
  blocks it). `npm run test:ui` will fail here; rely on `test:unit` +
  `test:integration` and HTTP-level checks with `curl` instead.
- The CSRF token for API calls is embedded in rendered pages and sent via the
  `x-csrf-token` header; the cookie is httpOnly.
- `.gitignore` anchors the build output as `/public/` (repo-root only) so
  `server/public/` (committed admin static assets) is preserved — don't change it
  back to a bare `public/`.
