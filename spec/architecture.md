# Architecture

## Goals

1. Survive on a 1-vCPU, 1–2 GB RAM cloud VM.
2. The public site stays up even when the admin process is down or crashing.
3. No deployment pipeline, no container orchestrator, no message bus, no
   second database. One repo, one process, one file.
4. A volunteer with basic Node experience can read the entire system in a day.

## Process model

Exactly two processes in production:

1. **Caddy** — TLS termination and reverse proxy. Owns ports 80/443, terminates
   Let's Encrypt, forwards everything to `127.0.0.1:3000`.
2. **Node** — a single `node server/index.js` running as the `mercy` user. Owns
   port 3000 bound to loopback. Serves three things on the same listener:
   - The pre-built public site (flat files in `public/`) via `express.static`.
   - The admin UI under `/admin/*` (server-rendered Nunjucks).
   - The JSON API under `/api/*`.

No worker process. No queue. The build is invoked inline from the admin app
(`server/routes/build.js:23` schedules the build via `setImmediate`). One build
runs at a time; concurrent requests get `409 Conflict`.

## Data layer

One SQLite file (`config.databasePath`). better-sqlite3 in WAL mode. The same
file holds:

- `users`, `content`, `content_revisions`, `media`, `builds` (see
  [content-model.md](./content-model.md) and [authentication.md](./authentication.md))
- The session store (a `sessions` table managed by `better-sqlite3-session-store`)

No connection pool — better-sqlite3 is synchronous and single-threaded; that is
fine at this traffic level.

## Repository layout

```
mercy-website/
├── site/                  # source for the public site
│   ├── templates/         # Nunjucks templates (one per public page + partials)
│   │   ├── _layout.njk
│   │   ├── _partials/{header,footer,mobile-menu}.njk
│   │   └── {index,visit,about,sermons,groups,events,give}.njk
│   └── assets/            # css, js, images — copied verbatim into public/
├── build/                 # build pipeline
│   ├── build.js           # entry point
│   ├── pages.js           # page registry
│   └── render.js          # Nunjucks env + helpers
├── public/                # GENERATED — the deployable artifact (gitignored)
├── server/                # Node admin app
│   ├── index.js           # Express bootstrap
│   ├── adminPages.js      # server-rendered /admin/* pages
│   ├── routes/            # JSON API
│   ├── middleware/        # requireAuth, requireSuperuser
│   ├── views/             # Nunjucks views for /admin/*
│   └── public/admin.css   # admin styling (small)
├── db/
│   ├── migrate.js
│   ├── migrations/        # SQL files, applied in order
│   └── seed-content.js    # canonical list of content keys
├── bin/                   # CLIs (create-user, rebuild)
├── tests/                 # unit, integration, playwright
└── data/                  # SQLite database lives here (gitignored)
```

The split is deliberate:

- `site/` is the **source** of the public site (templates + raw assets).
- `public/` is the **deployable artifact** (HTML files + hashed assets).
- `server/` is the **only thing Node executes in production**.

The build step reads `site/`, reads SQLite, writes `public/`. Nothing else
writes to `public/` except the upload handler, which writes images into
`public/assets/img/uploads/` directly (so they're visible without a rebuild).

## Technology choices

| Concern         | Choice                                      | Why                                                                            |
|-----------------|---------------------------------------------|--------------------------------------------------------------------------------|
| Runtime         | Node 20 LTS                                 | Long support, ubiquitous, fine on a small VM.                                  |
| HTTP            | Express 4                                   | Familiar to anyone who's done Node; mountains of middleware.                   |
| Templating      | Nunjucks                                    | Jinja-like, `extends`/`include`/`block`; same engine for build and admin.      |
| Database        | better-sqlite3                              | Synchronous, fast, no callback gymnastics. WAL mode.                           |
| Sessions        | `express-session` + `better-sqlite3-session-store` | One file, no extra service.                                               |
| Auth hashing    | bcrypt, cost 12                             | Slow-by-default; cost 12 keeps under 200ms on a small VM.                      |
| CSRF            | `csrf-csrf` (double-submit cookie)          | `csurf` is unmaintained. Cookie-based avoids stashing per-form tokens.         |
| Validation      | `zod`                                       | Schema-first, clear errors. Used on every JSON API input.                      |
| Image processing| `sharp`                                     | Just reads metadata; no resizing in v1.                                        |
| Logging         | `pino` + `pino-http`                        | JSON lines, fast, ships to stdout. systemd captures it.                        |
| Markdown        | `marked`                                    | At build time only. Output is wrapped in `SafeString`.                         |
| TLS             | Caddy                                       | One config block, automatic Let's Encrypt.                                     |
| Process supervision | systemd                                 | Already on the VM. `Restart=on-failure`.                                       |

No client-side framework. The admin uses plain server-rendered HTML; the public
site uses a small hand-written `script.js` for scroll reveals.

## What we deliberately don't have

- A second process for builds, image processing, or background jobs.
- A separate static-asset host or CDN. Caddy + Node handle that.
- An ORM. SQL is parameterized inline; the schema is small enough that an ORM
  is dead weight.
- A frontend framework, JSX, TypeScript, or a bundler. The CSS and JS in
  `site/assets/` are shipped as-is (with content-hashed filenames added at
  build time).
- A staging environment as part of the spec. (Operators can run one if they
  want; the architecture supports it but doesn't require it.)

## Boundaries between specs

- **Server routing** (Express, middleware, mounts) lives here in this doc and
  in `server/index.js`.
- **What the public site looks like** is [public-site.md](./public-site.md).
- **What's stored and how it's keyed** is [content-model.md](./content-model.md).
- **How a build runs** is [build-pipeline.md](./build-pipeline.md).
- **Who can do what** is [authentication.md](./authentication.md) +
  [security.md](./security.md).
- **What's promised by HTTP endpoints** is [api.md](./api.md) +
  [admin-app.md](./admin-app.md).
