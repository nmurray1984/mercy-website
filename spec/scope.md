# Scope: v1 and Beyond

Mercy v1 is "static brochure site with editable copy." Anything that doesn't
fit that description is deferred — sometimes because it's not needed yet,
sometimes because doing it badly is worse than not doing it. This document
lists what's in, what's out, and where to put new work when it lands.

## In v1

- Seven public pages: `/`, `/visit`, `/about`, `/sermons`, `/groups`, `/events`,
  `/give`. Rendered from Nunjucks templates at build time.
- A `content` table of editable strings, keyed `page.section.field`, with
  four kinds (`text`, `markdown`, `html`, `image`). Every edit logged in
  `content_revisions`. See [content-model.md](./content-model.md).
- A media library: upload images via the admin UI, get a URL, paste it into
  an `image`-kind content key. See [admin-app.md](./admin-app.md).
- A "Rebuild site" button that regenerates `public/` in under two seconds.
- Two roles: `admin` and `superuser`. See [authentication.md](./authentication.md).
- A SQLite-backed session store, CSRF protection, password lockout, rate
  limiting.
- A single Node process serving public site + admin + API on port 3000.
  TLS terminated by Caddy. systemd. Nightly SQLite backups. See
  [deployment.md](./deployment.md).
- A test suite (unit + integration + Playwright) that gates merges via `npm test`.

## Explicitly out of v1

Each item below was considered and deferred. The architecture leaves room for
each.

### Structured sermon archive

- A `sermons` table with `slug`, `title`, `passage`, `series`, `date`, audio
  URL, transcript text, etc.
- A `series` table.
- A list view at `/sermons` with filter-by-series.
- A detail view at `/sermons/<slug>/`.
- An RSS feed or podcast feed.

Today, sermons are an editable HTML blob on `/sermons` and a featured sermon
block on the home page. The transition path: add tables in a new migration,
extend `build/pages.js` to iterate over `sermons` and render
`public/sermons/<slug>/index.html` for each row, build an admin CRUD UI.

### Structured events

- An `events` table with `title`, `starts_at`, `ends_at`, `location`,
  `recurrence`, `description`.
- A list view that filters past vs upcoming.
- iCal export.

Today, events are an editable HTML blob.

### Structured groups / ministries

- A `groups` table (and possibly `group_meetings` for recurring schedules).
- An admin CRUD UI.

Today, groups are an editable HTML blob.

### Public-facing forms

- Contact form, newsletter signup, prayer request, "plan a visit" lead form.
- POST endpoints, spam protection (Cloudflare Turnstile or hCaptcha), email
  delivery (Postmark / Resend / SES).

This is the largest dependency-surface increase deferred to v2. Adding it
means: a new outbound network requirement, secret management for an email
provider, and bot-protection middleware on the relevant routes.

### Members-only area

- A directory.
- Per-member forms (background-check uploads, kids ministry forms, etc).
- Different role(s) than admin/superuser.
- Different threat model — actual PII at rest.

Worth its own design doc. Don't bolt this onto the existing roles.

### Site-wide search

- Either a static Lunr index built at build time, or a small `/api/search`
  endpoint backed by SQLite FTS5.

Lunr keeps the architecture purely-static and is simpler. FTS5 is more
flexible but adds runtime dependency on Node for search.

### Image processing

- Resize uploads to multiple breakpoints.
- Serve `<picture>` with `srcset`.
- WebP / AVIF conversion.

Today, sharp only reads metadata (`width`/`height`). The raw upload is what's
served.

### Public sitemap and `robots.txt`

Neither exists yet. Both are easy adds to the build step.

### Analytics

No analytics tag in v1. Adding one is a single content key change to
`_layout.njk` (insert a `<script>` block) — or, better, a dedicated
content key for "head scripts" rendered via `| thtml`.

### CI / CD

No GitHub Actions workflow shipped. The deploy is `git pull && npm ci
--omit=dev && npm run migrate && npm run seed && npm run build &&
systemctl restart mercy`. CI calling `npm test` on push is a useful add but
not required by the spec.

### Multi-environment configuration

No staging / production split in code. The same config file works in both;
operators can run a second VM with different `.env` values if they want a
staging copy. Adding a `config/<env>.js` layer would be premature.

## How to propose adding scope

If you're about to add one of the items above:

1. Open the relevant spec file (or create a new one) and write the contract
   FIRST. What new tables? What endpoints? What invariants?
2. Add migrations under `db/migrations/` with the next sequential number.
3. Implement.
4. Update [scope.md](./scope.md) to move the item from "out of v1" to "in v1".
5. Write tests at all three layers (unit / integration / Playwright) for the
   new surface.

Resist the urge to add scope without documenting it. The whole reason v1 is
shippable on a 1-vCPU VM is that the surface area is small enough to fit in
one head.
