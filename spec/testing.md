# Testing

Three layers. All locally runnable. CI is one command: `npm test`.

```
npm run test:unit            # vitest, pure functions
npm run test:integration     # vitest + supertest, full HTTP against temp SQLite
npm run test:ui              # playwright, real Chromium against built site + admin
npm test                     # all three in order, non-zero exit on any failure
```

Tests live under `tests/`:

```
tests/
├── _helpers/         # sandbox env, seeded users + content, supertest agent helpers
├── unit/             # pure-function tests, no HTTP
├── integration/      # supertest against the real Express app
└── playwright/       # global setup + UI specs
```

## Sandbox

`tests/_helpers/sandbox.js` produces a clean environment for each unit and
integration test:

- A fresh temp directory per test process.
- `DATABASE_PATH` set to a throwaway SQLite file inside it, **before** any
  server module is `require`d.
- Migrations applied; seed content loaded.
- A pair of pre-seeded users (`admin` and `superuser`).

Each unit/integration file gets its own temp database. There is no
test-to-test fixture leakage.

## Unit (`tests/unit/`)

Pure-function tests. No HTTP, no Express.

- `auth.test.js` — password validation, bcrypt hashing, lockout math, the
  last-superuser counter.
- `config.test.js` — boolean and number coercion in `server/config.js`.
- `render.test.js` — Nunjucks env helpers: `t`, `tmd`, `thtml`, `timg`,
  missing-key marker, `hasContent`.

Adding a new pure function in `server/` or `build/` SHOULD come with a unit
test in this directory.

## Integration (`tests/integration/`)

Supertest against the actual Express app, against a temp SQLite. Tests in
this layer MUST cover at minimum:

- `auth-routes.test.js` — login success, wrong password, missing user,
  lockout after 5 failures, CSRF rejection, session regeneration on login,
  logout.
- `content-routes.test.js` — list, get, update (with revision write), revert,
  404 on unknown keys, CSRF rejection, auth required.
- `users-routes.test.js` — create, update, delete, password change, role
  guard (admin can't list users), last-superuser guard returns `409`.
- `build-route.test.js` — `POST /api/build` starts a build, polling reflects
  status, a second concurrent request gets `409`.
- `build-pipeline.test.js` — exercises `build/build.js` against the temp DB
  and verifies `public/` outputs.

Per-IP login rate limiting is bypassed when `NODE_ENV=test` (see
`server/routes/auth.js:23`). Per-account lockout still applies and IS tested.

## Playwright (`tests/playwright/`)

End-to-end through a real browser against a real Node process.

- `global-setup.js` (re)builds and seeds a throwaway database in
  `tests/.playwright-tmp/`, then spawns the admin server pointing at it.
- `admin.spec.js` — log in, edit content, save, see the change reflected,
  trigger a rebuild, verify the change shows on the public page.
- `public.spec.js` — anonymous browsing: header, footer, page-to-page
  navigation, basic accessibility (page has `<h1>`, nav has `<nav>`, etc.).

Playwright spawns its own server and tears it down on exit. Chromium is the
only browser tested. First run requires `npx playwright install chromium`
(`npm run test:ui:install` is a shortcut).

## What the suite does NOT cover

- Visual regression. There's no screenshot diffing.
- Performance regressions (build time, request latency).
- Cross-browser behavior. Chromium only.
- Real email flows — there are none in v1.
- The systemd unit, Caddy config, or backup cron. Manual spot-check during
  deploy.

## CI expectations

CI MUST run `npm test` on every PR and on every push to `main`. A non-zero
exit blocks merge. The repo doesn't ship a workflow file — adding one is a
one-off setup task per CI provider.

## Running locally

```bash
npm ci
npm run migrate
npm run seed
node bin/create-user.js --email you@example.com --role superuser
npm run build
npm test
```

The build step is required before `test:ui` so Playwright has a real
`public/` to assert against.
