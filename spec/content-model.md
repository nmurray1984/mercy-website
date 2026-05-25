# Content Model

Every editable string on the public site is a row in the `content` table,
addressed by a stable key. Every edit is logged in `content_revisions`.
Uploaded images are tracked in `media`. The schema lives in
`db/migrations/001_init.sql`; seed data lives in `db/seed-content.js`.

## Tables

### `content`

```sql
CREATE TABLE content (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'text'
              CHECK (kind IN ('text','markdown','html','image')),
  page        TEXT,
  section     TEXT,
  label       TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_content_page ON content(page, section, sort_order);
```

- `key` — globally unique, dotted (`page.section.field`). Stable contract with
  templates. Renaming a key MUST be done as a migration that updates both the
  template and the row.
- `kind` — drives both the editor surface and the template filter:
  - `text` → escaped output (`| t`), single-line input
  - `markdown` → rendered to HTML at build time (`| tmd`), textarea
  - `html` → trusted, raw output (`| thtml`), textarea
  - `image` → URL/path (`| timg`), URL field
- `page`, `section`, `label`, `description`, `sort_order` — purely for the
  editor UI. Templates MUST NOT read them.
- `updated_at` / `updated_by` — set on every write.

### `content_revisions`

```sql
CREATE TABLE content_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_content_revisions_key ON content_revisions(key, updated_at DESC);
```

- Every successful UPDATE to `content` MUST first insert the **previous** row's
  value/updated_at/updated_by into this table. The transaction is in
  `server/routes/content.js:43` and mirrored in `server/adminPages.js:69`.
- No automatic pruning. 50 revisions per key are shown in the UI
  (`server/routes/content.js:62`).

### `media`

```sql
CREATE TABLE media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL UNIQUE,
  original    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  byte_size   INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
```

- `filename` is the disk filename inside `config.uploadDir`, generated as
  `<slug>-<8 hex>.<ext>`. The DB does not store the full path or URL.
- `original` is the upload's original filename, for display only.
- `width` / `height` are best-effort (set via sharp metadata for raster
  formats; null for SVG and on inspection failure).

### `builds`

```sql
CREATE TABLE builds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','ok','error')),
  log          TEXT NOT NULL DEFAULT '',
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT,
  triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
```

The dashboard reads the most recent row; the rebuild button writes one.

## Key conventions

Keys MUST follow `page.section.field`, lowercase, dot-separated. Examples:

- `home.hero.headline`
- `home.commitments.gathering.body`
- `visit.faq.body`
- `site.favicon`
- `footer.col_address.email`

`page` values that exist today:

- `site` — global (`header`, `footer`, `global` sections)
- `home`
- `visit`
- `about`
- `sermons`
- `groups`
- `events`
- `give`

The full canonical list of keys lives in `db/seed-content.js`. Adding a new
template variable MUST be paired with a new seed row in that file.

## Seeding

`npm run seed` runs `db/seed-content.js`. The script:

1. Iterates the `SEED` array in source order.
2. For each row:
   - If the key does not exist, INSERT it with the given default value.
   - If the key exists, do NOT touch `value`. Only `label` / `description` /
     `sort_order` / `kind` / `page` / `section` may be updated so editor
     metadata can be refined without losing edited copy.
3. Logs how many rows were inserted vs. updated.

This means seeding is **idempotent and non-destructive**. Anyone can re-run it
after a deploy. The only way to overwrite an edited value via seed is to
explicitly delete the row first.

## Editing

Reads and writes go through one of two surfaces:

- The admin UI (`server/adminPages.js` → `/admin/content/:key`). Forms are
  HTML, CSRF-protected, no JavaScript needed to save.
- The JSON API (`server/routes/content.js` → `PUT /api/content/:key`). Same
  semantics: validate, insert revision, update row, return new row.

Both write the previous version into `content_revisions` in the same
transaction as the UPDATE. If either statement fails, neither is applied.

Revert: `POST /api/content/:key/revert/:revId` (and the equivalent button on
the edit page) treats a revert as a normal edit — it writes the current value
into `content_revisions` first, then UPDATEs with the older value. So reverts
are themselves revertable.

## Validation

- `kind` MUST be one of `text | markdown | html | image`. Anything else is
  rejected (`server/routes/content.js:12`).
- `value` is always a string. Empty string is allowed and is the default.
- No length cap is enforced at the DB level; the API limits request bodies to
  256 KB via `express.json({ limit: '256kb' })` (`server/index.js:80`).
- No HTML sanitization on `html` kind. The editor is trusted (it's an
  admin/superuser); CSP and template wrapping limit damage if they get it wrong.

## What this model is NOT

The `content` table is for **editable strings on otherwise-fixed pages**. It is
explicitly NOT a CMS for records. Sermons, events, groups, ministries — if
they need their own list views, slugs, dates, or filtering, they need their
own tables. See [scope.md](./scope.md).

The pragmatic v1 compromise: events, groups, and the sermons archive are stored
as single `html`-kind content keys (`home.events.body`, `groups.body`, etc.).
That gets us a launchable site without writing a sermon CMS. It will not scale
to "filter sermons by series" — that's an explicit v2 problem.
