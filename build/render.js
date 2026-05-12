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
 */
function buildEnv({ templatesDir, content, assets }) {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(templatesDir, { noCache: true }),
    { autoescape: true, throwOnUndefined: false }
  );

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
    // Plain text — escape on output
    return row.value;
  });

  env.addFilter('tmd', function (key) {
    const row = lookup(key);
    if (!row) return missingMarker(key);
    const html = marked.parse(row.value || '');
    return new nunjucks.runtime.SafeString(html);
  });

  env.addFilter('thtml', function (key) {
    const row = lookup(key);
    if (!row) return missingMarker(key);
    return new nunjucks.runtime.SafeString(row.value || '');
  });

  env.addFilter('timg', function (key) {
    const row = lookup(key);
    if (!row || !row.value) return '';
    return row.value; // a URL or /assets/img/... path
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

module.exports = { buildEnv, writeAtomic, hashFile };
