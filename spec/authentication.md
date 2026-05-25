# Authentication

Sessions, password handling, roles, and account lockout. The relevant code is
in `server/auth.js`, `server/routes/auth.js`, and
`server/middleware/requireAuth.js`.

## Users table

```sql
CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin','superuser')),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT
);
```

Email is unique and stored lowercased + trimmed (`server/auth.js:42`). Any
lookup MUST normalize the input the same way.

## Roles

Exactly two roles in v1. Adding a third MUST come with a spec change.

| Role        | Can do                                                                              |
|-------------|-------------------------------------------------------------------------------------|
| `admin`     | Sign in, edit content, upload media, trigger rebuilds, change own password.         |
| `superuser` | Everything above, plus create / edit / delete users, reset any password, change roles, deactivate. |

### Last-active-superuser invariant

The system MUST refuse any operation that would leave zero active superusers.
Specifically, both the HTML form path (`server/adminPages.js:139`) and the
JSON API (`server/routes/users.js:88`, `server/routes/users.js:108`) call
`auth.countOtherActiveSuperusers(targetId)` and reject when the count is zero
and the operation would demote, deactivate, or delete the only active
superuser.

This invariant MUST hold even if the database is edited directly — but we
don't try to enforce it via a constraint, because that's annoying during
bootstrap. The CLI `bin/create-user.js` is the only intended bypass.

## Passwords

- Minimum length: **12 characters** (`server/auth.js:9`).
- No composition rules (no required digits, symbols, mixed case). Length beats
  complexity.
- Rejected against a small list of common passwords (`server/auth.js:11`).
  The list is opinionated to this church — `mercydallas`, `jesusisking`,
  `godlovesyou`, etc.
- Hashed with bcrypt, cost 12 (`server/auth.js:6`).
- `password` is never logged. `req.headers.cookie` and `set-cookie` are
  redacted at the pino logger (`server/index.js:46`).

### Validation flow

`auth.validatePassword(password)` is the only validator. It returns:

- `null` if the password passes.
- A human-readable error string otherwise.

It is called from:
- `auth.createUser` — invoked by both the JSON `POST /api/users` and the
  HTML form `POST /admin/users`.
- The self-password change route (`POST /api/users/:id/password`).
- The admin self-account page (`POST /admin/account`).
- The CLI `bin/create-user.js`.

## Login

`POST /api/auth/login` (and the equivalent HTML form `POST /admin/login`,
which shares the same router; see `server/index.js:182`).

Order of operations (`server/routes/auth.js:27`):

1. Reject if `email` or `password` is missing → `400`.
2. Look up the user by lowercased email.
3. **Always** run bcrypt to avoid a timing oracle. If the user doesn't exist,
   bcrypt is compared against a static invalid hash. The check passes only if
   the user exists, is active, not currently locked, and the password matches.
4. If failed: if the user exists, increment `failed_attempts`. After 5 failed
   attempts, set `locked_until = now + 15 minutes`. Return `401`.
5. If the account is locked: return `423`.
6. On success: reset `failed_attempts=0`, `locked_until=NULL`, set
   `last_login_at=now`. Regenerate the session (rotates the session id),
   store `userId` and `role` in the session, return `200`.

### Rate limiting

- 10 login attempts per minute per IP, via `express-rate-limit`
  (`server/routes/auth.js:15`).
- Skipped when `NODE_ENV=test` (so tests don't share-IP themselves out of the
  build).
- Per-account lockout still applies in tests; the lockout test exercises that.

## Sessions

- Stored in SQLite via `better-sqlite3-session-store`. Same DB file as
  everything else; no extra service.
- Cookie name: `mercy.sid`.
- Cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` in production
  (`COOKIE_SECURE=true`).
- Idle timeout: `SESSION_IDLE_SECONDS`, default 12 hours.
- Sessions are regenerated on login (`server/routes/auth.js:49`) to prevent
  session fixation.
- Logout calls `session.destroy()` and clears the `mercy.sid` cookie.
- Expired sessions are pruned every 15 minutes by the session store
  (`server/index.js:96`).

## Middleware

`requireAuth` (`server/middleware/requireAuth.js:9`):

1. If `req.session.userId` is unset → deny.
2. Load the user. If missing or `is_active=0`, destroy the session and deny.
3. Attach the user row as `req.user`. Continue.

Deny behavior:
- For `/api/*` requests: `401 { error: "authentication required" }`.
- For browser requests: redirect to `/admin/login?next=<originalUrl>`. The
  `next` param is honored after login only if it begins with `/admin`
  (`server/routes/auth.js:68`) — this prevents open-redirect via login.

`requireSuperuser`: the same but additionally requires `req.user.role === 'superuser'`.
Returns `403 { error: "superuser required" }` (API) or `403 Forbidden` text.

## First user / bootstrap

`bin/create-user.js` is the bootstrap path. It:

1. Parses `--email <addr> --role <admin|superuser>` from argv.
2. Prompts for a password (twice).
3. Calls `auth.createUser` — which validates the password and bcrypt-hashes it.

This is the only path that creates a user without an existing logged-in
superuser. It MUST be runnable from the deployment shell.

## What this spec doesn't cover

- Email verification, "forgot password" emails, MFA. None of these exist in
  v1. Forgot-password is handled by a superuser doing a manual reset; this is
  acceptable because the user population is small and trusted.
- OAuth or SSO. Not in v1.
- API tokens. The only API client today is the admin UI itself, which uses
  the session cookie.
