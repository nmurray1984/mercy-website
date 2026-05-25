# Mercy Presbyterian Website — Specs

This folder is the specification for the Mercy Presbyterian Church website. Each
file describes one slice of the system: what it must do, what it must not do,
and the contracts other slices can rely on. The specs describe **the system as
built today** (v1) — not aspirations. If the code disagrees with a spec, that's
a bug in one of them; fix the disagreement before adding new behavior.

These are written so a new contributor (volunteer or otherwise) can pick up
any one file and ship a change without having to read the whole codebase.

## How the system fits together

```
       ┌────────────────────────────────────────────┐
HTTPS  │  Node (single process)                     │
─────► │   /assets/*   sendFile(public/assets/…)    │
       │   /*          sendFile(public/<path>.html) │
       │   /admin/*    server-rendered Nunjucks     │
       │   /api/*      JSON API                     │
       └────────────────────────────────────────────┘
                          │
                          ▼
                   mercy.sqlite
```

One Node process, one SQLite file, one filesystem tree of pre-built HTML. No
nginx (Caddy terminates TLS in production), no per-request rendering for
public pages, no client-side framework.

## Contents

| Spec | What it covers |
|------|----------------|
| [architecture.md](./architecture.md)       | Process model, repo layout, runtime topology, technology choices. |
| [public-site.md](./public-site.md)         | The seven public pages, URL structure, caching, SEO. |
| [content-model.md](./content-model.md)     | The `content`, `content_revisions`, and `media` tables. Key conventions. Content kinds. |
| [build-pipeline.md](./build-pipeline.md)   | `npm run build`: how SQLite → flat HTML, atomic writes, asset hashing. |
| [admin-app.md](./admin-app.md)             | `/admin/*` pages, editor UX, media library, rebuild flow. |
| [api.md](./api.md)                         | JSON endpoints under `/api/*`. Request/response shapes, status codes. |
| [authentication.md](./authentication.md)   | Users, roles, sessions, passwords, lockout. |
| [security.md](./security.md)               | CSP, CSRF, cookies, rate limits, threat model. |
| [deployment.md](./deployment.md)           | Production VM layout, systemd, Caddy, backups, upgrades. |
| [testing.md](./testing.md)                 | What unit, integration, and Playwright tests cover. CI expectations. |
| [scope.md](./scope.md)                     | What v1 includes, what it explicitly excludes, where future work goes. |

## Conventions used in these docs

- **MUST / MUST NOT / SHOULD** are used in the RFC-2119 sense. Anything else is
  description, not requirement.
- Code paths are written `file:line` so they're clickable in an editor.
- Status codes follow what the code actually returns. If a spec says `409` and
  the code returns `400`, the code is wrong unless the spec is updated first.
- Schemas in these specs are the source of truth for shape; column-level
  constraints live in `db/migrations/*.sql`.
