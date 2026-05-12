# Mercy Presbyterian — Build Plan

A static public site, a small Node admin app, one SQLite file. Nginx serves the compiled HTML; Node handles login, content editing, user management, and an on-demand rebuild. The public site keeps running even when the admin process is down.

## 1. Architecture at a glance

```
                          ┌─────────────────────────────────────────┐
  visitor ── HTTPS ───►   │  nginx                                  │
                          │   /            ── /var/www/mercy/public │
                          │   /admin/*     ── proxy → node :3000    │
                          │   /api/*       ── proxy → node :3000    │
                          │   /assets/*    ── /var/www/mercy/public │
                          └─────────────────────────────────────────┘
                                          │
                                          ▼
                          ┌─────────────────────────────────────────┐
  admin    ── HTTPS ───►  │  Node app (express + nunjucks)          │
                          │   - admin SPA-ish pages (server-rendered)│
                          │   - JSON API for content + users        │
                          │   - build runner (spawns build script)  │
                          │   - reads/writes mercy.sqlite           │
                          └─────────────────────────────────────────┘
                                          │
                                          ▼
                          mercy.sqlite (single file)
```

Two processes total: nginx and node. One database file. The build script reads SQLite plus the templates and writes flat HTML into `public/`. Nginx then serves those files with no Node round-trip.

## 2. Stack

The defaults below are chosen for boring reliability on a small VM. Each is replaceable.

- Runtime: Node 20 LTS.
- Web framework: **Express 4**. Familiar, small, plenty of middleware. Fastify is a fine alternative; Express wins on community familiarity for a project a volunteer may inherit.
- Templating: **Nunjucks**. Jinja-like syntax, supports `extends`/`include`/`block`, used both at build time for static pages and at runtime for admin pages. One engine, two callers.
- Database: **better-sqlite3**. Synchronous, fast, simple. Avoids the callback gymnastics of `sqlite3`.
- Migrations: hand-rolled SQL files in `db/migrations/`, applied in order at startup. No ORM. Schema is small enough that an ORM is dead weight.
- Auth: **express-session** with a SQLite-backed store (`better-sqlite3-session-store`). Cookies signed, `HttpOnly`, `Secure`, `SameSite=Lax`. Passwords hashed with **bcrypt** (cost 12).
- CSRF: `csurf` is unmaintained; use `csrf-csrf` (double-submit cookie) on state-changing routes.
- Validation: `zod` on every API input.
- Build trigger: HTTP endpoint inside the admin app that runs the build script in-process (or spawns it). A file lock prevents overlapping builds.
- Logging: `pino` with rotation via logrotate on the VM.
- Process supervision: `systemd`.
- TLS: Let's Encrypt via `certbot`, renewed by cron.

No client-side framework. Admin pages are server-rendered HTML with a small amount of vanilla JS for the editor — enough to autosave a textarea, no more.

## 3. Repository layout

```
mercy-website/
├── mockup/                  # current static mockup, kept as reference
├── site/                    # NEW — source for the public site
│   ├── templates/
│   │   ├── _layout.njk      # shared shell (header, nav, footer)
│   │   ├── _partials/
│   │   │   ├── header.njk
│   │   │   ├── footer.njk
│   │   │   └── mobile-menu.njk
│   │   ├── index.njk
│   │   ├── visit.njk
│   │   ├── about.njk
│   │   ├── sermons.njk
│   │   ├── sermon.njk
│   │   ├── groups.njk
│   │   ├── events.njk
│   │   └── give.njk
│   ├── assets/              # css, js, images, fonts — copied verbatim
│   │   ├── styles.css
│   │   └── script.js
│   └── data/                # any static fixtures (e.g. mission partners)
│       └── leadership.json
├── build/
│   ├── build.js             # entry: render every page, copy assets, write public/
│   ├── render.js            # nunjucks env + helpers
│   └── pages.js             # explicit list of pages, each with its data loader
├── public/                  # GENERATED — never edited by hand, gitignored
├── server/                  # NEW — node admin + API
│   ├── index.js
│   ├── config.js
│   ├── db.js
│   ├── auth.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── content.js
│   │   ├── users.js
│   │   └── build.js
│   ├── middleware/
│   │   ├── requireAuth.js
│   │   └── requireSuperuser.js
│   ├── views/               # nunjucks for the /admin UI
│   │   ├── _layout.njk
│   │   ├── login.njk
│   │   ├── dashboard.njk
│   │   ├── content-list.njk
│   │   ├── content-edit.njk
│   │   ├── users.njk
│   │   └── account.njk
│   └── public/              # admin-only css/js (small)
├── db/
│   ├── migrations/
│   │   ├── 001_init.sql
│   │   ├── 002_content.sql
│   │   └── 003_users.sql
│   └── seed.js              # creates first superuser interactively
├── bin/
│   ├── create-user          # CLI for one-off user creation (bootstrap)
│   └── rebuild              # CLI rebuild
├── package.json
├── .env.example
└── PLAN.md                  # this file
```

The split is deliberate: `site/` is the source of public pages, `public/` is the deployable artifact, `server/` is the only thing Node runs in production. The build script reads `site/` and writes `public/`.

## 4. The build pipeline

A single `node build/build.js` does the following, in order.

1. Open the SQLite database read-only and load every row from the `content` table into a flat object keyed by `key`.
2. Initialise a Nunjucks environment rooted at `site/templates/` with a custom filter `t` so templates can write `{{ "home.hero.headline" | t }}`. Unknown keys render as the key wrapped in a visible marker (`«home.hero.headline»`) so missing copy is obvious during review.
3. Iterate the page registry in `build/pages.js`. Each entry is `{ url, template, data }`. `data` is a function so a page can load extra fixtures (a sermon's list of recent series, for example).
4. Render each template, write to `public/<url>/index.html` (or `public/index.html` for `/`). Use atomic writes (write to a temp file, then rename) so nginx never sees a half-written file.
5. Copy `site/assets/**` to `public/assets/` with content-hashed filenames for cache busting. Update a manifest the templates can read via a `{{ asset('styles.css') }}` helper.
6. Write a `public/_build.json` with the git SHA, timestamp, and content-row count. The admin dashboard reads this to show "last build."

The whole build should run in under two seconds for a site this size. It is safe to run concurrently with nginx because the swap is per-file atomic and idempotent.

## 5. The content model

The user asked for text edits stored as key/value. That is exactly the right shape for editable copy. It is **not** the right shape for sermons, events, or groups — those are records, not strings. I'm calling that out now because the requirements doc lists both kinds. This plan covers the text-key system. Structured entities (sermon archive, events, groups directory) are noted as v2 in §10.

### Schema

```sql
CREATE TABLE content (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'text',  -- text | markdown | html
  page        TEXT,                          -- 'home', 'visit', 'about', etc.
  section     TEXT,                          -- 'hero', 'commitments', 'footer'
  label       TEXT,                          -- human-friendly name for the admin UI
  description TEXT,                          -- guidance for the editor
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER REFERENCES users(id)
);

CREATE TABLE content_revisions (
  id          INTEGER PRIMARY KEY,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  INTEGER REFERENCES users(id)
);
```

Every edit writes a row to `content_revisions` before updating `content`. Two reasons: undo, and a defensible audit trail when copy changes around a sensitive topic.

### Key convention

`page.section.field`, lowercase, dot-separated. Example keys from the existing mockup:

- `home.hero.headline_line1` → "Mercy *to* us."
- `home.hero.headline_line2` → "Mercy *through* us."
- `home.commitments.gathering.body`
- `home.first_time.paragraph_1`
- `visit.parking.note`
- `footer.address.street`

Keys are seeded from the existing mockup HTML during initial conversion. The conversion step (§9) is mostly mechanical: walk each mockup page, replace literal copy with `{{ key | t }}`, insert a seed row.

### Editor UX

The admin "Edit content" page lists keys grouped by `page` and `section`. Each key shows its label, current value, and an inline edit field. `kind` decides the input: a single-line input for short strings, a textarea for paragraphs, a markdown textarea with a live preview for longer copy. Saving updates the row, writes a revision, and offers a "Rebuild site" button. The button kicks off the build script and shows progress.

Markdown is preferred over raw HTML for editable bodies — it limits the damage an admin can do to layout, and it lets us syntax-check during build.

## 6. Authentication and roles

### Users table

```sql
CREATE TABLE users (
  id              INTEGER PRIMARY KEY,
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

### Roles

- **admin**: log in, edit content, trigger rebuilds, change own password.
- **superuser**: everything an admin can do, plus create users, deactivate users, reset any user's password, promote/demote roles. A superuser cannot demote or deactivate themselves if they are the last active superuser — the API enforces this so the system can't be locked out by accident.

Two roles is enough. Adding a permissions table now would be over-engineering. If a third role appears, the schema is easy to extend.

### Session handling

Sessions are server-side, stored in SQLite. The cookie carries only an opaque session id. Idle timeout: 12 hours. Absolute timeout: 7 days. Logout deletes the session row server-side.

### Login flow

`POST /api/auth/login` with `{ email, password }`. On success, set the session cookie and redirect to `/admin`. On failure, increment `failed_attempts`. After five failures within 15 minutes, set `locked_until` to 15 minutes out. The login page is itself rendered by Node at `GET /admin/login`.

### Password rules

Minimum 12 characters. No other composition rules — length beats complexity. New passwords are checked against a small blocklist (top 1,000 common passwords) and rejected if matched. No password rotation policy.

### First superuser

`node bin/create-user --email you@example.com --role superuser` prompts for a password, hashes it, inserts the row. Run once at install. Documented in the README.

## 7. The admin app

Pages, all behind `requireAuth`:

- `GET /admin/login` — login form. The only unauthenticated admin page.
- `GET /admin` — dashboard. Shows last build time, last content edit, last login, link to rebuild.
- `GET /admin/content` — grouped list of content keys.
- `GET /admin/content/:key` — edit a single key (used for long markdown bodies; short keys are edited inline on the list).
- `GET /admin/users` — list (superuser only).
- `GET /admin/users/new` — create (superuser only).
- `GET /admin/users/:id` — edit, reset password, deactivate (superuser only).
- `GET /admin/account` — change own password.
- `POST /admin/logout`.

Every page extends a shared `_layout.njk` with a sidebar. Server-rendered. Forms use progressive enhancement: they work without JavaScript, JS just adds autosave and inline edits.

## 8. JSON API

Used by the admin pages (for autosave and the rebuild button) and available for future automation. All routes require an authenticated session except `/api/auth/login`. All POST/PUT/DELETE require a CSRF token.

```
POST   /api/auth/login           { email, password } → 204, sets cookie
POST   /api/auth/logout          → 204
GET    /api/me                   → { id, email, role }

GET    /api/content              → [{ key, value, kind, page, section, label, updated_at }]
GET    /api/content/:key         → { ... }
PUT    /api/content/:key         { value } → { updated_at }

GET    /api/content/:key/revisions       → [{ id, value, updated_at, updated_by }]
POST   /api/content/:key/revert/:revId   → { value, updated_at }

POST   /api/build                → { buildId } 202, build runs async
GET    /api/build/:buildId       → { status: 'running'|'ok'|'error', log }

GET    /api/users                → [...]   (superuser)
POST   /api/users                { email, role, password } → { id }   (superuser)
PUT    /api/users/:id            { email?, role?, is_active? }       (superuser)
POST   /api/users/:id/password   { password }                        (superuser, or self)
DELETE /api/users/:id            → 204                               (superuser)
```

Rate limits on `/api/auth/login` (10/minute/IP) and on `/api/build` (1 build at a time, queue depth 1).

## 9. The mockup → templates conversion

This is the largest chunk of one-off work and worth describing concretely.

1. Copy `mockup/styles.css` and `mockup/script.js` into `site/assets/`.
2. For each HTML file in `mockup/`, create a corresponding `.njk` in `site/templates/`.
3. Extract the `<header>`, mobile menu, and `<footer>` into `_partials/` and have each page `{% include %}` them.
4. Create `_layout.njk` with the `<html>`/`<head>`/`<body>` shell and a `{% block content %}` for the page-specific body.
5. Walk each template and replace literal copy with `{{ key | t }}`. Maintain a running CSV (`site/content.seed.csv`) of every new key with its initial value, kind, page, section, and label.
6. `db/seed.js` reads `content.seed.csv` and upserts every row into the `content` table. Re-running the seed is non-destructive: it only inserts keys that don't yet exist, never overwrites edited values.
7. Run the build, diff `public/index.html` against `mockup/index.html`. They should be identical modulo whitespace.

This step is the one most likely to surface "we need to edit this thing that isn't text" — image swaps, link rewrites, list items. Each of those is a small decision to make as we hit it.

## 10. What's in v1 — and what isn't

**In v1**

- Eight public pages, byte-equivalent to the current mockup, generated from templates.
- SQLite-backed editable copy with revisions.
- Admin login, content editor, rebuild button, user management.
- Two roles (admin, superuser).
- nginx + systemd deployment, TLS, daily SQLite backup.

**Not in v1, but the architecture leaves room**

- Structured content (sermons, events, groups). These need their own tables, list views, and edit forms. The same build pipeline can render `public/sermons/<slug>/index.html` for each row.
- Image uploads. The admin app would need a media library and a writable assets directory in `public/`.
- Public search. Either a static index built at build time (Lunr) or a small `/api/search` endpoint. Static index is simpler.
- Public-facing forms (contact, newsletter, prayer request). These need POST endpoints, spam protection, and email delivery. Adds a real dependency surface — worth pricing separately.
- Member-only pages (directory, forms). Different threat model. Worth its own design.
- Sermon audio hosting, podcast feed, video embeds.

The v1 scope is "static brochure site with editable copy." That is what the request describes. The rest is on the requirements doc and worth scoping next.

## 11. Deployment on the VM

Assume an Ubuntu 22.04 / 24.04 LTS box, 1 vCPU, 1–2 GB RAM. That's plenty.

- nginx as the public-facing server. One server block per hostname. TLS via certbot.
- Node app runs as user `mercy`, listens on `127.0.0.1:3000` only. systemd unit at `/etc/systemd/system/mercy.service` with `Restart=on-failure`.
- File layout on the VM:
  - `/opt/mercy/app/` — the deployed repo
  - `/var/www/mercy/public/` — the built site (nginx root)
  - `/var/lib/mercy/mercy.sqlite` — the database, mode 0600, owner `mercy`
  - `/var/log/mercy/` — pino output
- Deploys: `git pull && npm ci && npm run migrate && npm run build && systemctl restart mercy`. Wrap in a single shell script in `bin/deploy`. No container, no CI in v1 — that can come later.
- Backups: nightly cron job runs `sqlite3 mercy.sqlite ".backup '/var/backups/mercy/mercy-$(date +%F).sqlite'"`, keeps 30 days, rsyncs offsite (S3 or a second VM).
- Monitoring: a basic `healthz` endpoint plus an UptimeRobot ping. Logs go to the local filesystem; if log volume grows, ship to a hosted service later.

### Example nginx server block

```nginx
server {
  listen 443 ssl http2;
  server_name mercydallas.com;

  ssl_certificate     /etc/letsencrypt/live/mercydallas.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/mercydallas.com/privkey.pem;

  root /var/www/mercy/public;
  index index.html;

  # Long cache for hashed assets, short cache for HTML
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
  location ~* \.html$ {
    add_header Cache-Control "public, max-age=300";
  }

  location /admin/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }

  # Pretty URLs — try /foo, then /foo/, then /foo.html
  location / {
    try_files $uri $uri/ $uri.html =404;
  }
}
```

## 12. Security posture

- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax`, signed with a 32-byte secret from `.env`.
- CSRF: double-submit cookie pattern on every state-changing endpoint.
- Password hashing: bcrypt cost 12.
- Login throttling: per-IP and per-account.
- No SQL string interpolation anywhere; only parameterised statements.
- HTML escaping: Nunjucks auto-escapes; the only unescaped output is `{{ ... | safe }}` for explicitly-markdown-rendered content.
- Headers: `helmet` defaults plus a strict `Content-Security-Policy` (no inline scripts, no remote scripts beyond what the mockup already loads).
- Admin app reachable only via HTTPS. nginx redirects HTTP to HTTPS.

## 13. Open questions for you

These materially shape the work and I would rather decide now than guess.

1. **Conversion fidelity.** The mockup links to images at `mercydallas.com/wp-content/...`. Do we host those locally (download into `site/assets/img/`) or keep referring back to the old WordPress URLs until the v1 launch?
2. **Image edits in admin.** Is "edit text" enough for v1, or does an admin also need to swap the hero photo, the sermon series art, etc.? If yes, this becomes more than a key/value system and adds noticeable scope.
3. **Markdown vs plain text.** I'd default to markdown for paragraph-length copy so admins can add a link or bold a word without HTML. Confirm?
4. **Sermon archive.** The requirements doc lists ~418 sermons, filterable. That isn't in v1 above. Is it in scope for the first launch, or does v1 ship with a placeholder sermons page that we replace later?
5. **Domain and DNS.** Are we cutting over `mercydallas.com` or launching at a staging host first? This affects TLS issuance timing and the rollback story.
6. **Hosting.** "Small cloud VM" — Hetzner, DigitalOcean, Linode, AWS Lightsail? Cost and CLI ergonomics differ a bit. Any preference?
7. **Backups offsite.** Where should the nightly SQLite snapshot land?

## 14. Suggested sequence of work

Rough order, not a Gantt chart. Each line is a self-contained chunk you could stop at and still have something working.

1. Repo skeleton, package.json, migrations runner, `bin/create-user`.
2. Build pipeline rendering one page from a single template + one content key. Prove the loop end-to-end.
3. Convert all eight mockup pages to templates and seed every content key. Confirm `public/` matches the mockup byte-for-byte (modulo whitespace).
4. Express app, login, sessions, `requireAuth`. Bare dashboard.
5. Content list + edit + revisions + rebuild button.
6. User management (superuser).
7. nginx config, systemd unit, TLS, backup cron. Dry-run deploy.
8. Cut over.

I'd budget two to three working days for steps 1–3, two for 4–6, one for 7–8. Less if you don't want me to write tests; more if you do.
