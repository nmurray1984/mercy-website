# JSON API

All endpoints under `/api/*`. Used by the admin pages where they help (autosave,
async build) and available for future automation. Every state-changing route
requires a valid CSRF token.

## Conventions

- Request bodies are JSON. The server accepts up to 256 KB
  (`server/index.js:80`). Multipart bodies are accepted only on
  `POST /api/media`.
- Responses are JSON with `Content-Type: application/json` unless noted.
- Validation is `zod`. Validation failures return `400` with
  `{ error: <zod issues array | string> }`.
- Authentication is required on every endpoint **except** `POST /api/auth/login`.
  Unauthenticated requests get `401 { error: "authentication required" }`.
- Superuser-only endpoints return `403 { error: "superuser required" }` to
  non-superusers.
- CSRF token comes from the `__Host-mercy.csrf` (production) or `mercy.csrf`
  (dev) cookie and MUST be echoed in the request via one of:
  - `_csrf` field in the body
  - `_csrf` query string
  - `X-CSRF-Token` request header
- Missing/invalid CSRF on a state-changing request returns
  `403 { error: "invalid or missing CSRF token" }`.

## Authentication

### `POST /api/auth/login`

Body:
```json
{ "email": "you@example.com", "password": "minimum-twelve-chars" }
```

Responses:
- `200 { id, email, role }` — sets `mercy.sid` session cookie.
- `400 { error }` — missing field.
- `401 { error }` — bad credentials. Always returns the same message regardless
  of whether the email exists. Always runs bcrypt to avoid a timing oracle
  (`server/routes/auth.js:35`).
- `423 { error }` — account currently locked.

Rate limit: 10 requests per minute per IP. Skipped when `NODE_ENV=test`.
Per-account lockout is enforced independently (5 failures → 15 minutes).

### `POST /api/auth/logout`

Destroys the session, clears the cookie. Returns `204` (or redirects to
`/admin/login` for browser-form requests).

## Content

All routes require auth.

### `GET /api/content`

Returns every content row, ordered by `page, section, sort_order, key`:
```json
[
  { "key": "home.hero.headline", "value": "...", "kind": "html",
    "page": "home", "section": "hero", "label": "Hero headline",
    "description": "...", "updated_at": "2026-05-20 10:32:00",
    "updated_by": 1 }
]
```

### `GET /api/content/:key`

Returns one row. `404 { error: "not found" }` if absent.

### `PUT /api/content/:key`

Body:
```json
{ "value": "new value", "kind": "text" }
```

- `kind` is optional; defaults to the existing row's kind.
- `kind` MUST be one of `text | markdown | html | image`.
- Behavior:
  - Insert previous value into `content_revisions`.
  - UPDATE `content` with `value`, `kind`, `updated_at=now`, `updated_by=req.user.id`.
  - Both statements in a single transaction.
- Returns the updated row.
- `404` if the key doesn't exist (we don't auto-create keys via API).

### `GET /api/content/:key/revisions`

Returns up to 50 revisions, newest first.

### `POST /api/content/:key/revert/:revId`

- Looks up the revision; `404` if not found OR if it doesn't belong to `:key`.
- Treats revert as an edit: snapshots the current value into
  `content_revisions`, then UPDATEs with the revision's value.
- Returns the now-current row.

## Users

All routes require auth. `GET / POST / PUT / DELETE` require superuser; the
self-password endpoint is permitted for self.

### `POST /api/users/:id/password`

Allowed if `:id === req.user.id` OR `req.user.role === 'superuser'`.

Body:
```json
{ "password": "minimum-twelve-chars" }
```

- Password validated against rules in [authentication.md](./authentication.md).
- On success: hash stored, `failed_attempts=0`, `locked_until=NULL`. Returns
  `{ ok: true }`.
- `403` if the caller is neither self nor superuser.

### `GET /api/users` *(superuser)*

Returns every user, sorted by email:
```json
[{ "id": 1, "email": "...", "role": "superuser", "is_active": 1,
   "created_at": "...", "last_login_at": "...",
   "failed_attempts": 0, "locked_until": null }]
```

### `POST /api/users` *(superuser)*

Body:
```json
{ "email": "new@example.com", "role": "admin", "password": "..." }
```

- `role` MUST be `admin` or `superuser`.
- Password validated; conflicts on email return `400` with the SQLite error.
- Success: `201 { id, email, role }`.

### `PUT /api/users/:id` *(superuser)*

Body (any subset):
```json
{ "email": "...", "role": "admin", "is_active": true }
```

- Last-superuser guard: if the change would leave zero active superusers,
  responds `409 { error: "Refusing to demote or deactivate the last active superuser." }`.
- Success: returns `{ id, email, role, is_active }`.

### `DELETE /api/users/:id` *(superuser)*

- Last-superuser guard: same `409` as above for the last active superuser.
- Otherwise: hard-delete. Returns `204`.

## Build

### `POST /api/build`

Triggers an asynchronous build.

- `202 { buildId }` on accept.
- `409 { error, buildId }` if another build is in-flight.
- The build runs via `setImmediate`; check status via `GET /api/build/:id` or
  `GET /api/build/latest`.

### `GET /api/build/latest`

Returns the most recent build row, or `null`.

### `GET /api/build/:id`

Returns one build row. `404` if not found.

Build rows look like:
```json
{ "id": 7, "status": "ok",
  "log": "Built 7 pages in 412ms. Content rows: 184.",
  "started_at": "2026-05-25 02:18:00",
  "finished_at": "2026-05-25 02:18:00",
  "triggered_by": 1 }
```

`status` is one of `pending | running | ok | error`.

## Media

### `GET /api/media`

Returns all media rows, newest first:
```json
[{ "id": 5, "filename": "hero-a1b2c3d4.jpg", "original": "hero.JPG",
   "mime": "image/jpeg", "width": 1600, "height": 900, "byte_size": 240135,
   "uploaded_at": "..." }]
```

### `POST /api/media`

Multipart upload. Field: `file`.

- Accepts `image/jpeg | image/png | image/webp | image/gif | image/svg+xml`.
  Anything else fails the multer `fileFilter`.
- Max size: 8 MB.
- Writes the file to `config.uploadDir`.
- For raster formats, reads `width`/`height` via sharp.
- `201 { id, filename, url, width, height }`. `url` is the public path
  (`/assets/img/uploads/<filename>`).

### `DELETE /api/media/:id`

Deletes the row and best-effort `unlink` the file. Returns `204`.

## Health

### `GET /healthz`

Unauthenticated. Returns `{ "ok": true }`. Use it for uptime checks.

## What the API does NOT provide

- No "list public-site routes" endpoint.
- No bulk content editing.
- No JSON endpoint to create new content keys (use the seed file + migration).
- No pagination on `/api/content` or `/api/media`. The site is small enough
  not to need it.
- No `GET /api/me`. The session cookie tells the client who they are by virtue
  of having been issued.
