#!/usr/bin/env node
'use strict';

/**
 * Build the public site.
 *
 *   1. Read every row from `content` and `media` in SQLite.
 *   2. Copy site/assets/** to public/assets/** with content-hashed filenames.
 *   3. Render each page in build/pages.js with the content map.
 *   4. Atomically write public/<url>/index.html.
 *   5. Write public/_build.json with build metadata.
 *
 * Runs once. The admin app shells out to this on rebuild.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../server/config');
const pages = require('./pages');
const { buildEnv, writeAtomic, hashFile } = require('./render');

function loadContent(db) {
  const rows = db.prepare('SELECT key, value, kind FROM content').all();
  const map = {};
  for (const r of rows) map[r.key] = r;
  return map;
}

function copyAssets(siteAssetsDir, publicAssetsDir) {
  // Walk site/assets/, copy every file. For css/js, prepend a short content hash
  // to the filename so browsers cache forever but pick up new versions on edit.
  const manifest = {};

  function walk(srcDir, dstDir, rel = '') {
    if (!fs.existsSync(srcDir)) return;
    fs.mkdirSync(dstDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const srcPath = path.join(srcDir, entry.name);
      const dstPath = path.join(dstDir, entry.name);
      const relPath = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) {
        walk(srcPath, dstPath, relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const hashed = ext === '.css' || ext === '.js';
        if (hashed) {
          const h = require('crypto').createHash('sha1')
            .update(fs.readFileSync(srcPath)).digest('hex').slice(0, 8);
          const base = entry.name.slice(0, -ext.length);
          const hashedName = `${base}.${h}${ext}`;
          const outPath = path.join(dstDir, hashedName);
          fs.copyFileSync(srcPath, outPath);
          manifest[relPath] = path.posix.join(rel, hashedName);
        } else {
          fs.copyFileSync(srcPath, dstPath);
          manifest[relPath] = relPath;
        }
      }
    }
  }

  walk(siteAssetsDir, publicAssetsDir);
  return manifest;
}

function urlToOutputPath(publicDir, url) {
  if (url === '/' || url === '') return path.join(publicDir, 'index.html');
  const trimmed = url.replace(/^\/|\/$/g, '');
  return path.join(publicDir, trimmed, 'index.html');
}

function build({ verbose = true } = {}) {
  const startedAt = Date.now();
  const db = new Database(config.databasePath, { readonly: false });
  try { db.pragma('journal_mode = WAL'); } catch (_e) {}

  const content = loadContent(db);
  const assets = copyAssets(
    path.join(config.siteDir, 'assets'),
    path.join(config.publicDir, 'assets')
  );

  const env = buildEnv({
    templatesDir: path.join(config.siteDir, 'templates'),
    content,
    assets,
  });

  const written = [];
  for (const page of pages) {
    const data = (page.data ? page.data() : {});
    const html = env.render(page.template, { ...data, page: page, content });
    const out = urlToOutputPath(config.publicDir, page.url);
    writeAtomic(out, html);
    written.push(path.relative(config.publicDir, out));
  }

  const meta = {
    builtAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    contentRows: Object.keys(content).length,
    pages: written,
  };
  writeAtomic(path.join(config.publicDir, '_build.json'), JSON.stringify(meta, null, 2));

  db.close();
  if (verbose) {
    console.log(`built ${written.length} pages in ${meta.durationMs}ms`);
    for (const w of written) console.log('  ' + w);
  }
  return meta;
}

if (require.main === module) {
  try {
    build();
  } catch (e) {
    console.error('build failed:', e.stack || e.message);
    process.exit(1);
  }
}

module.exports = { build };
