'use strict';

/**
 * Global setup for Playwright. Runs once before all specs.
 *
 *   1. Tear down any previous .playwright-tmp directory.
 *   2. Point env vars at a fresh temp database and public/ output.
 *   3. Run migrations.
 *   4. Seed two users (admin + superuser) and a handful of content rows.
 *   5. Build the public site so the static pages exist before the webServer
 *      hands them out.
 *
 * The same env vars are set in playwright.config.js so the spawned server
 * sees the same paths.
 */

const fs = require('fs');
const path = require('path');

module.exports = async () => {
  const TMP_ROOT = path.join(__dirname, '..', '.playwright-tmp');
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });

  // Set env vars BEFORE requiring anything that reads them.
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = path.join(TMP_ROOT, 'mercy.sqlite');
  process.env.PUBLIC_DIR = path.join(TMP_ROOT, 'public');
  process.env.UPLOAD_DIR = path.join(TMP_ROOT, 'uploads');
  process.env.SESSION_SECRET = 'a'.repeat(64);
  process.env.CSRF_SECRET = 'b'.repeat(64);
  process.env.COOKIE_SECURE = 'false';
  process.env.LOG_LEVEL = 'silent';

  const { migrate } = require('../../db/migrate');
  migrate();

  const auth = require('../../server/auth');
  const db = require('../../server/db');

  await auth.createUser({
    email: 'admin@example.com',
    password: 'correct-horse-battery-staple',
    role: 'admin',
  });
  await auth.createUser({
    email: 'root@example.com',
    password: 'correct-horse-battery-staple',
    role: 'superuser',
  });

  // A minimal set of keys that the templates actually look for. The build
  // renders missing keys as `«key»` markers, but seeding the few keys the
  // UI tests assert on keeps the suite focused on behavior, not chrome.
  const seedRows = [
    { key: 'site.title',         value: 'Mercy Presbyterian',                   kind: 'text', page: 'site',   section: 'head',   label: 'Site title' },
    { key: 'site.description',   value: 'A church in Dallas.',                  kind: 'text', page: 'site',   section: 'head',   label: 'Site description' },
    { key: 'home.title',         value: 'Mercy Presbyterian',                   kind: 'text', page: 'home',   section: 'head',   label: 'Home title' },
    { key: 'home.description',   value: 'Welcome to Mercy.',                    kind: 'text', page: 'home',   section: 'head',   label: 'Home description' },
    { key: 'home.hero.headline', value: 'Mercy to us. Mercy through us.',       kind: 'html', page: 'home',   section: 'hero',   label: 'Hero headline' },
    { key: 'home.hero.dateline', value: 'Sunday',                               kind: 'html', page: 'home',   section: 'hero',   label: 'Dateline' },
    { key: 'visit.title',        value: 'Visit Mercy',                          kind: 'text', page: 'visit',  section: 'head',   label: 'Visit title' },
    { key: 'visit.headline',     value: 'Visit us at 123 Mercy Lane',           kind: 'html', page: 'visit',  section: 'hero',   label: 'Visit headline' },
    { key: 'about.title',        value: 'About Mercy',                          kind: 'text', page: 'about',  section: 'head',   label: 'About title' },
    { key: 'sermons.title',      value: 'Sermons',                              kind: 'text', page: 'sermons', section: 'head',  label: 'Sermons title' },
    { key: 'groups.title',       value: 'Groups',                               kind: 'text', page: 'groups', section: 'head',   label: 'Groups title' },
    { key: 'events.title',       value: 'Events',                               kind: 'text', page: 'events', section: 'head',   label: 'Events title' },
    { key: 'give.title',         value: 'Give',                                 kind: 'text', page: 'give',   section: 'head',   label: 'Give title' },
    { key: 'footer.copy',        value: '© Mercy Presbyterian',                kind: 'text', page: 'footer', section: 'copy',   label: 'Footer line' },
  ];

  const stmt = db.prepare(`
    INSERT INTO content (key, value, kind, page, section, label)
    VALUES (@key, @value, @kind, @page, @section, @label)
  `);
  const tx = db.transaction((rows) => { for (const r of rows) stmt.run(r); });
  tx(seedRows);

  const { build } = require('../../build/build');
  build({ verbose: false });
};
