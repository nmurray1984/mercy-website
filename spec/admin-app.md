# Admin App

The administrative UI at `/admin/*`. Server-rendered Nunjucks. Forms POST
standard `application/x-www-form-urlencoded` payloads with a CSRF token; the
same actions are available as JSON via the [API](./api.md).

The admin app MUST work without JavaScript. JS is only used for autosave
niceties.

## Pages

All routes below require an authenticated session (`requireAuth`). The login
page is the only exception. Pages tagged **(superuser)** additionally require
`role='superuser'`.

| Route                        | Method | Page                                                 |
|------------------------------|--------|------------------------------------------------------|
| `/admin/login`               | GET    | Login form. Unauthenticated.                         |
| `/admin/login`               | POST   | Submit credentials.                                  |
| `/admin/logout`              | POST   | Destroy session, redirect to login.                  |
| `/admin`                     | GET    | Dashboard. Last build, content count, last edit.     |
| `/admin/content`             | GET    | All content keys, grouped by page → section.         |
| `/admin/content/:key`        | GET    | Edit one key. Shows last 20 revisions.               |
| `/admin/content/:key`        | POST   | Save new value.                                      |
| `/admin/build`               | POST   | Trigger a synchronous rebuild. Redirects to `/admin`.|
| `/admin/media`               | GET    | Media library. List + upload form.                   |
| `/admin/media`               | POST   | Upload an image.                                     |
| `/admin/media/:id/delete`    | POST   | Delete an image.                                     |
| `/admin/account`             | GET    | Self-account page (change own password).             |
| `/admin/account`             | POST   | Change own password.                                 |
| `/admin/users`               | GET    | List of users. **(superuser)**                       |
| `/admin/users/new`           | GET    | New user form. **(superuser)**                       |
| `/admin/users`               | POST   | Create a user. **(superuser)**                       |
| `/admin/users/:id`           | GET    | Edit a user. **(superuser)**                         |
| `/admin/users/:id`           | POST   | Update / reset password / delete. **(superuser)**    |

## Dashboard

`GET /admin` shows (`server/adminPages.js:23`):

- Last build (`builds.id DESC LIMIT 1`) — status, started_at, finished_at, log.
- Active user count.
- Total content row count.
- Most recent content edit (key + timestamp).
- "Rebuild site" button (POSTs to `/admin/build`).

## Content editing

### List page (`/admin/content`)

Groups every row by `page`, then `section`. Inside a section, sort by
`sort_order` then `key`. Each row links to its individual edit page.

### Edit page (`/admin/content/:key`)

- Renders the field appropriate to `kind`:
  - `text` → `<input type="text">`
  - `markdown` / `html` → `<textarea>` (markdown gets a hint; no live preview)
  - `image` → URL field + preview
- Shows up to 20 prior revisions with editor email and timestamp. Each has a
  "revert" button that POSTs a revert action.
- Save flow:
  1. Validate CSRF (middleware in `server/index.js:176`).
  2. Insert the previous value into `content_revisions`.
  3. UPDATE the row.
  4. Flash "Saved key." and redirect back to the same page.
- Both operations happen inside a single `db.transaction` (`server/adminPages.js:69`).

### Rebuild

`POST /admin/build` runs the build **synchronously** inside the request handler,
inserts a `builds` row, flashes the log, and redirects to `/admin`. If the
build takes more than the default Express request timeout, the user sees a
gateway timeout — that's acceptable at the current site size.

The async path (`POST /api/build`) returns `202` and is preferred for
automation. See [api.md](./api.md).

## Media library (`/admin/media`)

- Lists every row in `media`, newest first.
- Upload form:
  - Field: `file` (multipart). MIME must be one of:
    `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/svg+xml`.
  - Max size: 8 MB.
  - Filename normalized to `<slug>-<8 hex>.<ext>`. Slug is up to 60 chars of
    `[a-z0-9-]` from the original name (`server/adminPages.js:224`).
  - For raster formats, sharp reads metadata (`width`, `height`). SVGs skip
    inspection.
  - File is written to `config.uploadDir` directly. In production this points
    inside `PUBLIC_DIR/assets/img/uploads/`, so the file is immediately
    serveable without a rebuild.
- Delete: removes the row AND attempts to `unlink` the file. The unlink is
  best-effort — missing files don't fail the delete.

Uploads MUST be tied to a logged-in user; `uploaded_by` is set to `req.user.id`.

## User management (`/admin/users`)

Superuser-only. Three operations are dispatched by the `action` field on the
edit form (`server/adminPages.js:139`):

| `action` value | Effect                                                                 |
|----------------|------------------------------------------------------------------------|
| `update`       | Set email, role, is_active.                                            |
| `password`     | Set a new password for the target user.                                |
| `delete`       | Hard-delete the user row.                                              |

### Last-superuser guard

The system MUST refuse any operation that would leave zero active superusers.
The guard runs before each of the three operations and uses
`auth.countOtherActiveSuperusers(targetId)`. Specifically:

- `update`: if the user is currently `superuser` AND active, AND the next
  state is not (`superuser` AND active), AND no other active superuser exists,
  reject with a flash error.
- `delete`: same condition, reject with a flash error.
- `password`: unaffected. A superuser can always reset their own password.

The JSON API enforces the same guard (`server/routes/users.js:88`,
`server/routes/users.js:108`) with `409 Conflict`.

## Self-account page (`/admin/account`)

Any logged-in user can change their own password here. The validation is
identical to user creation: `auth.validatePassword` ([authentication.md](./authentication.md)).

Successful password change resets `failed_attempts=0` and `locked_until=NULL`.

## Common middleware behavior

`server/index.js:133` populates `res.locals` for every request:

- `csrfToken` — function that returns (and caches per-request) a token.
- `flash` — `{ info: [...], error: [...] }` collected by `connect-flash`.
- `user` — the current user row, or `null`.
- `nav` — a string indicating which nav item is active.

All admin views extend `_layout.njk` (under `server/views/`) which renders the
sidebar and flash messages from `res.locals`.

## CSRF and forms

- Every admin form MUST include `<input type="hidden" name="_csrf" value="{{ csrfToken() }}">`.
- The middleware at `server/index.js:176` enforces this for every non-GET request.
- On token failure, the default error handler returns `403` with
  `{ error: 'invalid or missing CSRF token' }` for API requests, and the
  generic error view for browser requests.

## Error handling

- 404s on admin pages: handlers return `res.status(404).send('Not found')`.
- 5xx: caught by the default Express error middleware (`server/index.js:227`).
  Browser requests render `views/error.njk`; API requests get JSON.
- CSRF failures: special-cased to `403` with a structured message.
