'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nunjucks = require('nunjucks');
const { marked } = require('marked');

/**
 * Build a Nunjucks environment configured with helpers a Mercy template needs:
 *
 *   {{ "home.hero.headline" | t }}          → text key (HTML-escaped)
 *   {{ "home.about.body" | tmd }}           → markdown key rendered to HTML
 *   {{ "footer.address" | thtml }}          → raw HTML key (trusted)
 *   {{ "home.hero.image" | timg }}          → URL for an image key
 *   {{ asset('styles.css') }}               → hashed asset URL from the manifest
 *   {% missing 'home.hero.headline' %}      → renders a visible marker so missing
 *                                             copy stands out at review time
 *
 * `content` is a map { key → { value, kind } } produced once per build.
 * `assets`  is a map { 'styles.css' → 'styles.7af9c1.css' } produced after asset copy.
 *
 * When `editable` is true the env is rendered for the admin in-page editor
 * instead of the public build: text/markdown/html fields are wrapped in a
 * `<span class="mw-ed" data-mw-key data-mw-kind>` so the editor JS can make
 * them click-to-edit, and every image key seen is recorded on `env.mwImages`
 * so the editor can attach a "replace image" control. The public build never
 * passes `editable`, so its output is byte-for-byte unchanged.
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildEnv({ templatesDir, content, assets, editable = false }) {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(templatesDir, { noCache: true }),
    { autoescape: true, throwOnUndefined: false }
  );

  // Image keys encountered during an editable render, in order.
  env.mwImages = [];

  // Wrap rendered field output in an editable marker (editable mode only).
  // `innerHtml` must already be a trusted/escaped HTML string.
  function editWrap(key, kind, innerHtml) {
    const cls = kind === 'text' ? 'mw-ed mw-ed-text' : 'mw-ed mw-ed-rich';
    return new nunjucks.runtime.SafeString(
      `<span class="${cls}" data-mw-key="${escapeHtml(key)}" data-mw-kind="${kind}">${innerHtml}</span>`
    );
  }

  function lookup(key) {
    const row = content[key];
    if (!row) return null;
    return row;
  }

  function missingMarker(key) {
    return new nunjucks.runtime.SafeString(
      `<span class="missing-content" style="background:#fef3c7;color:#92400e;padding:0 4px;border:1px dashed #d97706;">«${key}»</span>`
    );
  }

  env.addFilter('t', function (key) {
    const row = lookup(key);
    if (!row) return missingMarker(key);
    // Plain text — escape on output. Stays attribute-safe (never wrapped), so
    // `t` is the right filter for alt="", <title>, meta, etc.
    return row.value;
  });

  // Editable plain text. Identical to `t` in the public build; in the editor it
  // wraps the (escaped) text so it can be clicked and edited in place. Only use
  // in element-body context, never inside an HTML attribute.
  env.addFilter('te', function (key) {
    const row = lookup(key);
    if (!row) return editable ? editWrap(key, 'text', missingMarker(key).toString()) : missingMarker(key);
    if (!editable) return row.value;
    return editWrap(key, 'text', escapeHtml(row.value || ''));
  });

  env.addFilter('tmd', function (key) {
    const row = lookup(key);
    if (!row) return editable ? editWrap(key, 'markdown', missingMarker(key).toString()) : missingMarker(key);
    const html = marked.parse(row.value || '');
    return editable ? editWrap(key, 'markdown', html) : new nunjucks.runtime.SafeString(html);
  });

  env.addFilter('thtml', function (key) {
    const row = lookup(key);
    if (!row) return editable ? editWrap(key, 'html', missingMarker(key).toString()) : missingMarker(key);
    const html = row.value || '';
    return editable ? editWrap(key, 'html', html) : new nunjucks.runtime.SafeString(html);
  });

  env.addFilter('timg', function (key) {
    const row = lookup(key);
    const value = row && row.value ? row.value : '';
    if (editable) env.mwImages.push({ key, value });
    return value; // a URL or /assets/img/... path
  });

  env.addGlobal('asset', function (name) {
    return '/assets/' + (assets[name] || name);
  });

  env.addGlobal('hasContent', function (key) {
    const row = lookup(key);
    return row && row.value && row.value.trim() !== '';
  });

  return env;
}

/**
 * Atomic file write: write to tmp, then rename. Prevents nginx from ever
 * serving a half-written file.
 */
function writeAtomic(filepath, contents) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const tmp = filepath + '.tmp-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filepath);
}

function hashFile(filepath) {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
}

/**
 * Rebuild the { 'styles.css' → 'styles.7af9c1.css' } asset manifest by reading
 * an already-built public/assets directory. Used by the live in-page editor so
 * its preview pulls the exact same hashed CSS/JS the public site serves.
 */
function loadAssetManifest(publicAssetsDir) {
  const manifest = {};
  if (!fs.existsSync(publicAssetsDir)) return manifest;
  for (const name of fs.readdirSync(publicAssetsDir)) {
    const m = name.match(/^(.*)\.[0-9a-f]{8}\.(css|js)$/);
    if (m) manifest[`${m[1]}.${m[2]}`] = name;
  }
  return manifest;
}

module.exports = { buildEnv, writeAtomic, hashFile, loadAssetManifest };
