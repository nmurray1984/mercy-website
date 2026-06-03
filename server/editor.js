'use strict';

/**
 * In-page visual editor (prototype).
 *
 * `GET /admin/edit/:slug` live-renders a real public page with the shared
 * Nunjucks env in `editable` mode, then injects a small toolbar + editor JS.
 * Admins click text/images on the page itself and edit them in place. Saves go
 * through the existing revisioned `PUT /api/content/:key`; "Publish" triggers
 * the normal `POST /api/build`. The published, public site stays 100% static —
 * this editor is only ever served to a logged-in admin.
 *
 * Mounted after adminPages so it inherits `app.use('/admin', requireAuth)`.
 */

const path = require('path');
const db = require('./db');
const config = require('./config');
const pages = require('../build/pages');
const { buildEnv, loadAssetManifest } = require('../build/render');

function slugFor(url) {
  if (url === '/' || url === '') return 'home';
  return url.replace(/^\/|\/$/g, '');
}

function loadContent() {
  const rows = db.prepare('SELECT key, value, kind FROM content').all();
  const map = {};
  for (const r of rows) map[r.key] = r;
  return map;
}

function injectChrome(html, ctx) {
  const head = `<link rel="stylesheet" href="/admin/static/edit.css" />`;
  const boot =
    `<script>window.__MW__ = ${JSON.stringify(ctx).replace(/</g, '\\u003c')};</script>` +
    `<script src="/admin/static/edit.js" defer></script>`;

  if (html.includes('</head>')) html = html.replace('</head>', head + '</head>');
  else html = head + html;

  if (html.includes('</body>')) html = html.replace('</body>', boot + '</body>');
  else html = html + boot;

  return html;
}

module.exports = function mountEditor(app) {
  const bySlug = {};
  for (const p of pages) bySlug[slugFor(p.url)] = p;

  app.get('/admin/edit', (req, res) => res.redirect('/admin/edit/home'));

  app.get('/admin/edit/:slug', (req, res) => {
    const page = bySlug[req.params.slug];
    if (!page) return res.status(404).send('Unknown page');

    const content = loadContent();
    const assets = loadAssetManifest(path.join(config.publicDir, 'assets'));
    const env = buildEnv({
      templatesDir: path.join(config.siteDir, 'templates'),
      content,
      assets,
      editable: true,
    });

    const data = page.data ? page.data() : {};
    let html;
    try {
      html = env.render(page.template, { ...data, page, content });
    } catch (e) {
      return res.status(500).send('Render error: ' + (e.message || e));
    }

    html = injectChrome(html, {
      slug: req.params.slug,
      csrfToken: req.csrfToken(),
      images: env.mwImages.filter((i) => i.value),
      pages: Object.keys(bySlug),
      presets: [
        { label: 'Normal', class: '' },
        { label: 'Lead paragraph', class: 'dropcap' },
        { label: 'Emphasis (italic)', class: 'display-italic' },
        { label: 'Eyebrow', class: 'eyebrow' },
        { label: 'Muted', class: 'muted' },
        { label: 'Gold', class: 'gold' },
      ],
    });

    res.set('Cache-Control', 'no-store');
    res.send(html);
  });
};
