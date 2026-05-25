# Build Pipeline

The build is the only thing that writes HTML into `public/`. Every public-site
change — copy edit, asset edit, template edit, image swap that needs new HTML —
runs through it.

Entry point: `build/build.js`. Invoked by:

- `npm run build` from the CLI.
- The admin "Rebuild site" button (`POST /admin/build` →
  `server/adminPages.js:82`).
- `POST /api/build` (async; returns `202` with a build id).

## What a build does

In order, in a single Node process:

1. **Open SQLite** (`config.databasePath`), set WAL pragma. The build opens
   the DB read-write but only reads from `content` for v1.
2. **Load content** — `SELECT key, value, kind FROM content` into a plain
   object keyed by `key` (`build/build.js:23`).
3. **Copy assets** — walk `site/assets/**` and copy each file to
   `public/assets/**`:
   - `.css` and `.js` files get a content-hash prefix on the extension
     (`styles.css` → `styles.7af9c1.css`). The mapping is recorded in a
     manifest passed to the Nunjucks env.
   - Every other file is copied verbatim (same path, same name).
4. **Build a Nunjucks env** rooted at `site/templates/` with these helpers
   (`build/render.js:23`):
   - Filters: `t`, `tmd`, `thtml`, `timg` (see [public-site.md](./public-site.md)).
   - Globals: `asset(name)`, `hasContent(key)`.
   - Missing-key behavior: render a yellow `«key»` marker, not an empty string.
5. **Render each page** in `build/pages.js` order. For each entry
   `{ url, template, data }`:
   - Call `data()` if provided, merge with `{ content, page }`, render the
     template.
   - Write the HTML to `public/<url>/index.html` (or `public/index.html` for
     `/`) **atomically**: write to a temp file with a random suffix, then
     `rename` (`build/render.js:83`).
6. **Write `public/_build.json`** — a small JSON file with `builtAt`,
   `durationMs`, `contentRows`, `pages`. The dashboard reads this for the
   "last build" display.
7. **Close the DB**, return the `meta` object.

A build MUST be safe to run while Node is also serving requests:

- Assets get content-hashed filenames, so a half-copied CSS file would have a
  different URL than any live page references.
- HTML writes are atomic, so static-file serving can't see a half-written file.

## Performance budget

Builds run in-process. A clean build of the seven public pages should finish
in well under 2 seconds on the production VM. If a future change pushes
build time above ~10 seconds, the inline-from-admin model needs to move to a
background worker — the current code path holds an HTTP connection open for
the duration (`server/adminPages.js:82`).

`POST /api/build` already runs the build via `setImmediate`, responding `202`
immediately and updating the `builds` row when done — that path doesn't have
the same constraint.

## Concurrency

Exactly one build at a time:

- The async API (`/api/build`) gates with an in-process `inflight` variable
  (`server/routes/build.js:13`). Subsequent calls return `409`.
- The admin HTML form (`POST /admin/build`) runs the build synchronously
  inside the request, so there's no overlap by construction.

This is correct for a single-process deployment. If the system is ever
horizontally scaled, the lock MUST move to the database (e.g., a row in
`builds` with `status='running'` and unique partial index).

## Build status tracking

Every build trigger inserts a row into `builds`:

- `status='running'` on insert.
- On success: `status='ok'`, log = "Built N pages in Xms. Content rows: Y."
- On error: `status='error'`, log = the stack/message, truncated to 4000 chars.
- `finished_at` set in both cases.

The dashboard shows the most recent row; `GET /api/build/latest` returns it.

## Failure modes and how the build handles them

| Failure                                  | Behavior                                                    |
|------------------------------------------|-------------------------------------------------------------|
| Missing content key                      | Page renders with a `«key»` marker. Build succeeds.         |
| Template syntax error                    | Build throws; row marked `error`; previous `public/` intact.|
| Asset directory missing                  | `walk()` no-ops on the missing dir (`build/build.js:36`).   |
| Write to `public/` fails (e.g. EACCES)   | Build throws; row marked `error`; previous output intact.   |
| DB locked / busy                         | better-sqlite3 retries internally; otherwise throws.        |

Atomic rename guarantees that even a partial build leaves the previously-built
pages serveable. Any page that was successfully rewritten before the crash will
be on the new version; the rest will be on the old version. This is acceptable
for v1; the alternative (staging dir + atomic swap of the entire tree) is more
machinery than the size of the site warrants.

## What the build does NOT do

- It does not validate HTML.
- It does not run a link checker.
- It does not minify CSS or JS.
- It does not resize or re-encode images.
- It does not write `robots.txt` or a sitemap.
- It does not delete stale files in `public/`. Removing a page means
  manually deleting its directory under `public/` after removing the entry
  from `pages.js`.

Each of those is a deliberate omission for v1. Adding one MUST come with a
spec change.
