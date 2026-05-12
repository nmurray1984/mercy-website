# Mercy Presbyterian website

Static public site, generated from Nunjucks templates and SQLite-backed content.
A single Node process serves everything: the flat HTML built into `public/`, the
admin UI under `/admin/*`, and the JSON API under `/api/*`. No nginx, no per-request
template rendering for public pages — Node only `sendFile()`s the prebuilt HTML.

```
       ┌────────────────────────────────────────────┐
HTTPS  │  Node                                      │
─────► │   /assets/*   sendFile(public/assets/…)    │
       │   /*          sendFile(public/<path>.html) │
       │   /admin/*    server-rendered Nunjucks     │
       │   /api/*      JSON API                     │
       └────────────────────────────────────────────┘
                          │
                          ▼
                   mercy.sqlite
```

One process. One SQLite file. Designed for a 1-vCPU cloud VM.

## Local development

Requires Node 20+.

```bash
git clone …
cd mercy-website

npm ci
cp .env.example .env

# Generate two random secrets and paste them into .env:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# For local dev over plain HTTP, also set COOKIE_SECURE=false in .env

npm run migrate
npm run seed                                   # seed the content table
node bin/create-user.js --email you@example.com --role superuser   # first user
npm run build                                  # build the public site
npm run dev                                    # start the admin app
```

Then open `http://localhost:3000/admin` and sign in. The public site lives in
`./public/` — point a static server at it, or just open the HTML files.

### Common scripts

```
npm run migrate          # apply any pending migrations
npm run seed             # seed/update content keys (non-destructive on existing keys)
npm run build            # render templates → public/
npm run create-user      # interactive user creation
npm start                # run the admin app
```

## Running the tests

Three layers, all locally runnable:

```
npm run test:unit            # vitest, pure functions (auth, config, render helpers)
npm run test:integration     # vitest + supertest, full HTTP cycle against a temp SQLite
npm run test:ui              # playwright, real Chromium against the built site + admin
npm test                     # all three in order; non-zero exit if any fail
```

The Playwright suite spawns its own admin server against a throwaway database
in `tests/.playwright-tmp/` and tears it down on exit. The first run needs
Chromium installed (`npx playwright install chromium`), or use the helper:

```
npm run test:ui:install
```

Tests are organised under `tests/`:

```
tests/
├── _helpers/         # sandbox env, seeded users + content, supertest agent helpers
├── unit/             # pure-function tests, no HTTP
├── integration/      # supertest against the real Express app
└── playwright/       # global setup + UI specs
```

Each unit/integration file gets its own temp SQLite (set via `DATABASE_PATH`
before any server module is required). The login rate limiter is bypassed
when `NODE_ENV=test`; per-account lockout still works and is tested.

To enforce tests before merge, point your CI at `npm test` — any failure
returns non-zero. A GitHub Actions workflow can wire that in directly when
you're ready.

## How content editing works

Every editable string on the site is a row in the `content` table, keyed
`page.section.field`. The build script reads these rows and renders templates
under `site/templates/`, writing flat HTML to `public/`.

Four kinds of content:

| kind     | use for                                | editor surface         |
|----------|----------------------------------------|------------------------|
| `text`   | short single-line strings              | text input             |
| `markdown` | paragraphs an admin will edit often  | textarea + Markdown    |
| `html`   | content with structural inline tags    | textarea (raw HTML)    |
| `image`  | image URLs or upload paths             | URL field + preview    |

Admins edit content under `/admin/content`. Each save logs a revision. Clicking
**Rebuild site** in the top right runs `node build/build.js`, which writes new
files into `public/`. No process restart needed.

## Roles

- **admin** — can edit content, upload images, trigger rebuilds, change own
  password.
- **superuser** — everything an admin can do, plus create/delete users, reset
  any user's password, change roles, deactivate accounts. The system refuses to
  demote, deactivate, or delete the last active superuser.

## Project layout

```
mercy-website/
├── site/                 # source for the public site
│   ├── templates/        # Nunjucks templates
│   │   ├── _layout.njk
│   │   ├── _partials/{header,footer,mobile-menu}.njk
│   │   └── {index,visit,about,sermons,groups,events,give}.njk
│   └── assets/           # css, js, images — copied verbatim into public/
├── build/                # build pipeline
│   ├── build.js          # entry point
│   ├── pages.js          # page registry
│   └── render.js         # Nunjucks env + helpers
├── public/               # GENERATED — the deployable artifact
├── server/               # Node admin app
│   ├── index.js          # Express bootstrap
│   ├── adminPages.js     # server-rendered /admin/* pages
│   ├── routes/           # JSON API
│   ├── middleware/
│   ├── views/            # Nunjucks views for /admin/*
│   └── public/admin.css  # admin styling
├── db/
│   ├── migrate.js
│   ├── migrations/       # SQL files, applied in order
│   └── seed-content.js   # canonical list of content keys
├── bin/                  # CLIs (create-user, rebuild)
└── data/                 # SQLite database lives here (gitignored)
```

## Deploying to a small cloud VM (Ubuntu 22.04/24.04)

The plan in `PLAN.md` describes the architecture. The short version: Node runs
as a systemd unit and serves the public site, admin, and API on a single port.
TLS is terminated by Caddy in front of it (one config block, automatic Let's
Encrypt). Alternatives — Cloudflare Tunnel, a managed load balancer, or Node
binding to 443 directly — work too; pick one.

### 1. System packages

```bash
sudo apt update
sudo apt install -y sqlite3 build-essential
# Node 20 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Caddy (for TLS in front of Node)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 2. Service user and directories

```bash
sudo useradd -r -s /usr/sbin/nologin -m -d /opt/mercy mercy
sudo mkdir -p /opt/mercy/app /var/lib/mercy /var/log/mercy /var/backups/mercy
sudo chown -R mercy:mercy /opt/mercy /var/lib/mercy /var/log/mercy /var/backups/mercy
```

### 3. Deploy the app

```bash
sudo -u mercy bash -lc '
  cd /opt/mercy/app
  git clone <your-repo> .   # or rsync your tree here
  npm ci --omit=dev
  cp .env.example .env
'
sudo -u mercy nano /opt/mercy/app/.env
```

Edit `.env`:

```
DATABASE_PATH=/var/lib/mercy/mercy.sqlite
PUBLIC_DIR=/opt/mercy/app/public
UPLOAD_DIR=/opt/mercy/app/public/assets/img/uploads
PORT=3000
SESSION_SECRET=<paste 96 hex chars>
CSRF_SECRET=<paste 96 hex chars>
COOKIE_SECURE=true
TRUST_PROXY=1
NODE_ENV=production
```

`UPLOAD_DIR` points inside `PUBLIC_DIR` so uploaded images are served
immediately without rebuilding the site.

```bash
sudo -u mercy bash -lc '
  cd /opt/mercy/app
  npm run migrate
  npm run seed
  node bin/create-user.js --email you@example.com --role superuser
  npm run build
'
```

### 4. systemd unit

`/etc/systemd/system/mercy.service`:

```ini
[Unit]
Description=Mercy website (Node)
After=network.target

[Service]
Type=simple
User=mercy
Group=mercy
WorkingDirectory=/opt/mercy/app
EnvironmentFile=/opt/mercy/app/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/mercy/app.log
StandardError=append:/var/log/mercy/app.log
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mercy
sudo systemctl status mercy
```

### 5. Caddy (TLS termination)

Replace `/etc/caddy/Caddyfile` with:

```
mercydallas.com, www.mercydallas.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

That's it — Caddy obtains and renews the Let's Encrypt certificate
automatically and proxies everything to Node. Make sure port 80 and 443 are
open on the firewall and DNS points to the VM.

### 6. Nightly SQLite backup

`/etc/cron.d/mercy-backup`:

```
0 3 * * * mercy /usr/bin/sqlite3 /var/lib/mercy/mercy.sqlite ".backup '/var/backups/mercy/mercy-$(date +\%F).sqlite'" && find /var/backups/mercy -name 'mercy-*.sqlite' -mtime +30 -delete
```

Ship the backup directory offsite (S3, rclone, a second VM — whatever). The
SQLite file is small; nightly is plenty.

### 7. Updates

```bash
sudo -u mercy bash -lc '
  cd /opt/mercy/app
  git pull
  npm ci --omit=dev
  npm run migrate
  npm run seed
  npm run build
'
sudo systemctl restart mercy
```

## Security notes

- Passwords hashed with bcrypt (cost 12).
- Sessions are signed, HTTP-only, `SameSite=Lax`, stored in SQLite.
- CSRF: double-submit cookie on every state-changing route.
- Login throttling: 10 attempts per IP per minute; per-account lockout after
  5 failures for 15 minutes.
- Helmet sets strict CSP, HSTS, etc.
- Node binds to 127.0.0.1:3000 — only the reverse proxy (Caddy) can reach it.

## What's out of scope for v1

- Sermons archive / sermon detail pages with real records (placeholder list
  for now; pointer to current site).
- Events, groups, and ministries as structured entities — they exist as
  editable HTML blobs today.
- Public-facing forms (contact, newsletter, prayer requests).
- Members-only area (directory, members forms).
- Site-wide search.

The architecture leaves room for each. See `PLAN.md` §10.
