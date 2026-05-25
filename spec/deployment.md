# Deployment

The target environment is a single Ubuntu 22.04 / 24.04 LTS VM, 1 vCPU,
1–2 GB RAM. No Docker, no Kubernetes, no CI in v1.

## What runs on the box

Two processes:

1. **Caddy** — terminates TLS, reverse-proxies to Node. Owns ports 80/443.
2. **Node** — `node server/index.js`. Owns `127.0.0.1:3000`.

Plus one cron job (nightly SQLite backup) and one logrotate config (Caddy
handles its own; pino streams to a file rotated externally).

## Filesystem layout on the VM

```
/opt/mercy/app/                   # the deployed repo
├── server/                       # source
├── build/
├── site/                         # templates + raw assets
├── public/                       # built site (gitignored upstream)
│   └── assets/img/uploads/       # uploaded images live here too
└── .env                          # production env, mode 0600

/var/lib/mercy/mercy.sqlite       # the database, mode 0600, owner mercy
/var/log/mercy/app.log            # pino output (append from systemd)
/var/backups/mercy/               # nightly SQLite snapshots
```

The service user is `mercy` (no shell). Everything under
`/opt/mercy /var/lib/mercy /var/log/mercy /var/backups/mercy` is owned by it.

## Environment variables

Loaded from `/opt/mercy/app/.env` by `server/config.js`. Required in production:

| Var                    | Purpose                                          | Default                                         |
|------------------------|--------------------------------------------------|-------------------------------------------------|
| `DATABASE_PATH`        | SQLite file path                                 | `data/mercy.sqlite` (relative — bad in prod)    |
| `PUBLIC_DIR`           | Built site root                                  | `public/`                                       |
| `UPLOAD_DIR`           | Where uploads go                                 | `site/assets/img/uploads`                       |
| `PORT`                 | Listen port                                      | `3000`                                          |
| `SESSION_SECRET`       | Sign session cookies                             | placeholder (must be replaced)                  |
| `CSRF_SECRET`          | Sign CSRF tokens                                 | placeholder (must be replaced)                  |
| `COOKIE_SECURE`        | Set `Secure` on cookies                          | `false`                                         |
| `SESSION_IDLE_SECONDS` | Session idle TTL                                 | `43200` (12h)                                   |
| `TRUST_PROXY`          | `app.set('trust proxy', N)`                      | `0`                                             |
| `LOG_LEVEL`            | pino level                                       | `info`                                          |
| `NODE_ENV`             | `production` in production                       | `development`                                   |

Production MUST set:
- `SESSION_SECRET` and `CSRF_SECRET` to fresh 48-byte hex strings.
- `COOKIE_SECURE=true` (the `__Host-` cookie prefix only kicks in then).
- `TRUST_PROXY=1` so the rate limiter and `req.ip` see Caddy's
  `X-Forwarded-For`.
- `NODE_ENV=production`.
- `DATABASE_PATH=/var/lib/mercy/mercy.sqlite`.
- `UPLOAD_DIR=/opt/mercy/app/public/assets/img/uploads` (inside `PUBLIC_DIR`
  so uploads are served without rebuild).

## systemd unit

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

Operationally: `systemctl restart mercy` after each deploy.

## Caddy

`/etc/caddy/Caddyfile`:

```
mercydallas.com, www.mercydallas.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains and renews Let's Encrypt certificates automatically. Ports 80 and
443 MUST be open on the firewall; DNS MUST point at the VM.

`reverse_proxy` sends everything to Node. Node decides what to serve (admin
pages, API, or pre-built HTML from `public/`).

## First-time deploy

1. Provision the VM, install Node 20 (NodeSource), Caddy, sqlite3.
2. `useradd -r -s /usr/sbin/nologin -m -d /opt/mercy mercy`.
3. Create the directory tree above; `chown -R mercy:mercy`.
4. As `mercy`: `git clone … /opt/mercy/app && cd /opt/mercy/app && npm ci --omit=dev`.
5. Copy `.env.example` to `.env`; fill in secrets and paths.
6. `npm run migrate && npm run seed`.
7. `node bin/create-user.js --email you@example.com --role superuser`.
8. `npm run build`.
9. Install the systemd unit and the Caddyfile above.
10. `systemctl enable --now mercy && systemctl reload caddy`.

The exact commands are in `README.md` (sections 3–5). The spec describes
**what** must be true; the README describes **how**.

## Update flow

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

The `npm run build` step is run during deploy so the `public/` tree is
up to date with any new templates or seed content. The admin's "Rebuild site"
button is for content edits only.

## Backups

A daily cron entry (`/etc/cron.d/mercy-backup`) runs:

```
0 3 * * * mercy /usr/bin/sqlite3 /var/lib/mercy/mercy.sqlite \
  ".backup '/var/backups/mercy/mercy-$(date +\%F).sqlite'" \
  && find /var/backups/mercy -name 'mercy-*.sqlite' -mtime +30 -delete
```

- Uses `sqlite3 .backup` (NOT a file copy) so backups are consistent under WAL.
- 30 days of retention locally.
- The directory SHOULD be replicated offsite (S3, rclone, rsync to a second
  VM). Doing this is a deployment decision, not part of the codebase.

## Health and observability

- `GET /healthz` returns `{ ok: true }`. Use it for uptime monitoring
  (UptimeRobot or equivalent).
- Application logs: pino JSON lines in `/var/log/mercy/app.log`.
- Caddy access logs: `/var/log/caddy/access.log` (if `log` directive added to
  the Caddyfile; off by default).
- No metrics endpoint, no Prometheus exporter.

## Rollback

There's no automated rollback. The procedure is:

1. `cd /opt/mercy/app && git log --oneline` to find the last good revision.
2. `git checkout <sha>`.
3. `npm ci --omit=dev && npm run migrate && npm run build`.
4. `systemctl restart mercy`.

If the change was content-only (edited via admin), revert via the per-key
revision UI and rebuild — no deploy needed.

If a migration is part of the bad change, restore from the latest backup
(`sqlite3 /var/lib/mercy/mercy.sqlite ".restore '/var/backups/mercy/mercy-YYYY-MM-DD.sqlite'"`)
before rolling back code, since the schema must match.

## What the spec does NOT prescribe

- Which cloud provider. Hetzner, DigitalOcean, Linode, AWS Lightsail — any of
  them work.
- Whether to put Cloudflare in front of Caddy. Optional.
- A staging environment. Operators may run a second VM with a different
  hostname; the code is environment-agnostic.
- Container builds. There's no Dockerfile in the repo by design.
