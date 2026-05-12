'use strict';

const fs = require('fs');
const path = require('path');

const { makeSandbox, cleanupSandbox } = require('../_helpers/sandbox');
const tmpRoot = makeSandbox();

const { migrate } = require('../../db/migrate');
migrate();

const auth = require('../../server/auth');
const db = require('../../server/db');
const { seedUsers, seedContent } = require('../_helpers/seed');
const config = require('../../server/config');
const { build } = require('../../build/build');

beforeAll(async () => {
  await seedUsers(db, auth);
  seedContent(db);
});

afterAll(() => cleanupSandbox(tmpRoot));

describe('build pipeline', () => {
  let meta;

  beforeAll(() => {
    meta = build({ verbose: false });
  });

  it('returns metadata with page list and content row count', () => {
    expect(meta.contentRows).toBeGreaterThanOrEqual(4);
    expect(meta.pages.length).toBe(7); // index, visit, about, sermons, groups, events, give
    expect(meta.durationMs).toBeGreaterThan(0);
  });

  it('writes an index.html for every page in the registry', () => {
    const expected = ['index.html',
      'visit/index.html', 'about/index.html', 'sermons/index.html',
      'groups/index.html', 'events/index.html', 'give/index.html'];
    for (const rel of expected) {
      const full = path.join(config.publicDir, rel);
      expect(fs.existsSync(full)).toBe(true);
      const html = fs.readFileSync(full, 'utf8');
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    }
  });

  it('substitutes seeded content into the rendered HTML', () => {
    const html = fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8');
    expect(html).toContain('Mercy to us. Mercy through us.');
  });

  it('marks missing content keys with a visible marker', () => {
    const html = fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8');
    // The seed only fills a few keys; the rest should render as «key» markers.
    expect(html).toMatch(/«[^»]+»/);
  });

  it('copies assets and hashes css/js filenames', () => {
    const assetsDir = path.join(config.publicDir, 'assets');
    expect(fs.existsSync(assetsDir)).toBe(true);
    const files = fs.readdirSync(assetsDir);
    const css = files.filter(f => f.endsWith('.css'));
    const js = files.filter(f => f.endsWith('.js'));
    expect(css.some(f => /\.[a-f0-9]{8}\.css$/.test(f))).toBe(true);
    expect(js.some(f => /\.[a-f0-9]{8}\.js$/.test(f))).toBe(true);
  });

  it('writes _build.json with build metadata', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(config.publicDir, '_build.json'), 'utf8'));
    expect(meta.builtAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(meta.pages).toBeInstanceOf(Array);
    expect(meta.contentRows).toBeGreaterThan(0);
  });

  it('is idempotent — running the build twice produces the same HTML', () => {
    const before = fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8');
    build({ verbose: false });
    const after = fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8');
    expect(after).toBe(before);
  });

  it('reflects content edits on the next build', () => {
    db.prepare(`UPDATE content SET value = ? WHERE key = ?`)
      .run('Brand new headline', 'home.hero.headline');
    build({ verbose: false });
    const html = fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8');
    expect(html).toContain('Brand new headline');
    expect(html).not.toContain('Mercy to us. Mercy through us.');
  });
});
