# Public Site

The user-visible site that visitors and search engines see. Generated once per
rebuild; served as flat HTML.

## Pages (v1)

The site has exactly seven public pages. The list lives in `build/pages.js` and
MUST stay in sync with the templates in `site/templates/`.

| URL        | Template       | Purpose                                                              |
|------------|----------------|----------------------------------------------------------------------|
| `/`        | `index.njk`    | Home. Hero, three commitments, featured sermon, upcoming events.     |
| `/visit`   | `visit.njk`    | Plan a first visit: location, parking, what to expect, FAQ.          |
| `/about`   | `about.njk`    | Mission, beliefs, staff, session of elders, deacons.                 |
| `/sermons` | `sermons.njk`  | Featured sermon + recent series. v1 is a placeholder, not an archive.|
| `/groups`  | `groups.njk`   | Community groups directory (editable HTML, not structured records).  |
| `/events`  | `events.njk`   | Upcoming events (editable HTML, not structured records).             |
| `/give`    | `give.njk`     | How to give. Includes external links.                                |

Every template extends `_layout.njk` (the shared `<html>` shell, header,
footer, scripts). Header and footer are included from
`site/templates/_partials/`.

Adding a page MUST involve:
1. A new `.njk` file under `site/templates/`.
2. An entry in `build/pages.js`.
3. New rows in `db/seed-content.js` for any editable strings on that page.
4. A header/footer/mobile-menu nav link if the page should appear in the menu.

## URL structure

- `/` writes to `public/index.html`.
- Every other route writes to `public/<route>/index.html`.
- Pretty URLs are served by:
  - `express.static(publicDir, { extensions: ['html'] })` — handles `/visit.html`
    style requests if a directory match fails.
  - A regex handler at `server/index.js:216` (`/^\/[^.]*$/`) that maps
    `/visit` → `public/visit/index.html`. The regex excludes paths with a dot
    so `/assets/foo.css` does not match.
- The system MUST NOT serve directory listings.

## Caching

`server/index.js` sets two cache tiers:

- `/assets/*` → `immutable, max-age=365d`. Filenames are content-hashed at
  build time, so a change to `styles.css` becomes a new URL.
- `*.html` and pretty URLs → `max-age=300`. Edits become visible within ~5
  minutes without forcing visitors to bypass cache.

Uploaded images live at `/assets/img/uploads/<filename>` and ride the same
`/assets/*` cache rule. Filenames include a random suffix (`crypto.randomBytes(4)`)
so re-uploading "logo.png" produces a fresh URL.

## Asset pipeline

- Source assets live in `site/assets/**`.
- The build (`build/build.js:30`) walks that tree and copies every file to
  `public/assets/**`.
- `.css` and `.js` files get a short content hash prefixed to the extension
  (`styles.css` → `styles.7af9c1.css`). All other files are copied verbatim.
- Templates reference assets via `{{ asset('styles.css') }}` — the helper looks
  up the hashed name in a manifest the build constructs.
- Uploaded images (admin → media library) live in `site/assets/img/uploads/`
  in source AND directly in `public/assets/img/uploads/` (the upload handler
  writes to `config.uploadDir`, which in production is set to the public path).

## Content rendering

Every editable string on a page is rendered through one of four filters
(implemented in `build/render.js`):

| Filter   | Use for             | HTML behavior                                                |
|----------|---------------------|--------------------------------------------------------------|
| `\| t`     | Plain text          | Auto-escaped by Nunjucks. Safe.                              |
| `\| tmd`   | Markdown content    | Rendered to HTML at build time, wrapped in `SafeString`.     |
| `\| thtml` | Trusted HTML        | Output verbatim. Only admins/superusers can edit these.      |
| `\| timg`  | Image URLs / paths  | Output as an attribute value; no further escaping needed.    |

If a key is missing from the `content` table, the filter MUST render a visible
yellow marker (`«key.name»`) — not an empty string. This forces missing copy to
show up at review time. See `build/render.js:35` (`missingMarker`).

`hasContent(key)` is a global function templates can use to conditionally
render whole blocks when a key is empty.

## Header / nav

The header partial (`site/templates/_partials/header.njk`) renders the same
markup on every page; "active" highlighting comes from the `active` data field
passed in `build/pages.js`. The mobile menu partial mirrors the desktop nav.

## SEO

- Every page MUST set a `<title>` and `<meta name="description">` via the
  `title` and `description` blocks in `_layout.njk`. Defaults pull from
  `site.title` and `site.description` content keys.
- `<link rel="icon">` is sourced from the `site.favicon` content key.
- No sitemap, no `robots.txt`, no structured data in v1. (Add when needed.)

## Out of scope for v1

- A real sermons archive with per-sermon pages, audio, transcripts.
- Structured event records (date, time, recurrence).
- Structured group/ministry records.
- Public-facing forms (contact, newsletter, prayer request).
- Members-only area.
- Site-wide search.
- Analytics tagging.

See [scope.md](./scope.md) for the full out-of-scope list.
