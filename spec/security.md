# Security

The threat model is small: a public-facing church website with a handful of
trusted admins. We're defending against scripted attacks, drive-by credential
stuffing, and the occasional motivated nuisance. Not nation-state actors, not
insider abuse from a compromised admin (other than the last-superuser guard).

## Defenses in place

### Cookies and sessions

- `mercy.sid` cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production,
  signed with `SESSION_SECRET`.
- Sessions are server-side (SQLite store). The cookie carries an opaque id.
- Sessions are regenerated on login to prevent fixation.
- Idle timeout 12 hours by default.

### CSRF protection

Double-submit cookie pattern via `csrf-csrf` (`server/index.js:111`).

- Cookie name: `__Host-mercy.csrf` in production, `mercy.csrf` in dev.
  The `__Host-` prefix requires `Secure`, which only holds in production.
- All non-GET/HEAD/OPTIONS requests under `/api/*` and `/admin/*` are gated by
  `doubleCsrfProtection` (`server/index.js:176`).
- Forms include `<input type="hidden" name="_csrf" value="{{ csrfToken() }}">`.
- JSON clients send `X-CSRF-Token` or `_csrf` in the body/query.
- The token-getter regenerates the cookie on demand (`overwrite=true`) so it
  always matches the current session identifier, which avoids stale-cookie
  failures after `session.regenerate()` on login (`server/index.js:137`).

### Password handling

- bcrypt cost 12 (`server/auth.js:6`).
- Minimum 12 characters, plus a small common-password blocklist
  (see [authentication.md](./authentication.md)).
- Constant-time-ish login: always run bcrypt even when the email is missing,
  so attackers can't time-distinguish "user doesn't exist" from "user exists,
  wrong password" (`server/routes/auth.js:35`).
- Per-account lockout: 5 failures in a row → 15-minute lock.
- Per-IP rate limit: 10 login attempts per minute (`server/routes/auth.js:15`).

### Content Security Policy

Set explicitly via Helmet (`server/index.js:56`). The directives are:

```
default-src 'self'
base-uri    'self'
script-src  'self' 'unsafe-inline'
style-src   'self' 'unsafe-inline'
img-src     'self' data: https:
font-src    'self' https: data:
connect-src 'self'
form-action 'self'
frame-ancestors 'none'
object-src  'none'
upgrade-insecure-requests       (production only)
```

Notes:
- `'unsafe-inline'` on script and style is permitted because the templates use
  inline `<style>` and small inline event handlers from the source design.
  Tightening this is a known follow-up.
- `frame-ancestors 'none'` prevents clickjacking of `/admin/*`.
- `upgrade-insecure-requests` is omitted in dev so plain http://localhost works.

HSTS is set by Helmet's default when `COOKIE_SECURE=true`; suppressed otherwise.

### SQL

- No string interpolation. Every query uses parameterized statements
  (`db.prepare(...).run(?,?,?)`).
- The schema lives in `db/migrations/001_init.sql`. Adding a column means a
  new migration file with a higher number, applied automatically by `db/migrate.js`.

### File uploads

- MIME type whitelist enforced in multer (`server/adminPages.js:201`,
  `server/routes/media.js:20`).
- 8 MB size limit.
- Filenames are NOT taken from user input. The server generates
  `<slug>-<8 hex bytes>.<ext>`. The slug is the original filename downcased
  and stripped to `[a-z0-9-]`, capped at 60 chars, falling back to `image`.
- SVGs are accepted but NOT inspected. They're written verbatim. Risk:
  an admin could upload an SVG with embedded scripts. CSP doesn't help here
  if the SVG is loaded via `<img>` (scripts are inert in that context) but
  WOULD help if loaded via `<object>` (we don't).
- The upload directory is configurable (`UPLOAD_DIR`). In production it points
  inside `PUBLIC_DIR`, so the upload is immediately served by `express.static`
  without a rebuild.

### Logging

- pino HTTP logger redacts `req.headers.cookie` and `res.headers['set-cookie']`
  (`server/index.js:47`).
- Passwords are never logged. (They never appear in URLs; only in bodies, which
  pino doesn't log by default.)

### Other Helmet defaults

- `x-powered-by` is removed (`server/index.js:28`).
- Helmet sets X-Content-Type-Options, X-Frame-Options (defense in depth with
  CSP `frame-ancestors`), Referrer-Policy, X-DNS-Prefetch-Control, etc.

### Network

- Node binds to `127.0.0.1:3000`. Only the Caddy reverse proxy on the same
  host can reach it.
- Caddy terminates TLS, obtains certificates automatically.

## What this does NOT defend against

The threat model explicitly excludes:

- A compromised admin (other than last-superuser lockout).
- Targeted denial-of-service. Rate limits on login are not a DoS defense; a
  determined attacker could exhaust bcrypt CPU. The mitigation is "have a
  small audience" and "Caddy can serve a maintenance page."
- Phishing of admin credentials. Use a password manager.
- A vulnerability in a transitive dependency. Mitigation: keep dependencies
  small and pin them via `package-lock.json`. There's no automated `npm audit`
  in CI; that's a known gap.
- An admin uploading a malicious file other than HTML/SVG. We trust them.
- Privilege escalation from the `mercy` system user to root. Mitigated by
  the systemd unit's `NoNewPrivileges=true`, `ProtectSystem=full`,
  `ProtectHome=true`, `PrivateTmp=true` (`README.md:243`).

## Secrets

- `SESSION_SECRET` and `CSRF_SECRET` MUST be at least 32 bytes of high-entropy
  random data. The README documents generating them with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- Defaults in `server/config.js` are obvious placeholders (`change-me-...`)
  so the system fails loudly if `.env` was not provisioned.
- `.env` MUST NOT be committed. `.env.example` is the template.

## Incident response

There is no formal IR playbook in v1. The expected response is:

1. Stop the Node process (`systemctl stop mercy`).
2. Take a SQLite snapshot (`.backup` command via sqlite3 CLI).
3. Investigate: pino logs are in `/var/log/mercy/app.log`. Caddy logs are
   under `/var/log/caddy/`.
4. Rotate secrets, force password resets, restart.

The public site keeps running independently — the `public/` directory is still
served by Caddy directly if Node is down, given the upstream is unreachable.
(With the default config, Caddy reverse-proxies everything to Node, so a Node
outage takes the public site down. Operators who want to harden against that
can serve `public/` from Caddy directly and proxy only `/admin/*` and `/api/*`.
That's a deployment decision, not a code change.)
