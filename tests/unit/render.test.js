'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildEnv, writeAtomic } = require('../../build/render');

let tmpDir;
let env;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercy-render-'));
  fs.mkdirSync(path.join(tmpDir, 'tpl'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'tpl', 'simple.njk'), `{{ 'home.headline' | t }}`);
  fs.writeFileSync(path.join(tmpDir, 'tpl', 'md.njk'), `{{ 'home.body' | tmd }}`);
  fs.writeFileSync(path.join(tmpDir, 'tpl', 'html.njk'), `{{ 'home.raw' | thtml }}`);
  fs.writeFileSync(path.join(tmpDir, 'tpl', 'img.njk'), `<img src="{{ 'home.hero' | timg }}">`);
  fs.writeFileSync(path.join(tmpDir, 'tpl', 'missing.njk'), `{{ 'never.set' | t }}`);
  fs.writeFileSync(path.join(tmpDir, 'tpl', 'asset.njk'), `{{ asset('styles.css') }}`);
  fs.writeFileSync(path.join(tmpDir, 'tpl', 'has.njk'),
    `{% if hasContent('home.body') %}yes{% else %}no{% endif %}`);
  fs.writeFileSync(path.join(tmpDir, 'tpl', 'te.njk'), `{{ 'home.headline' | te }}`);

  env = buildEnv({
    templatesDir: path.join(tmpDir, 'tpl'),
    content: {
      'home.headline': { value: 'Hello <world>', kind: 'text' },
      'home.body':     { value: '**bold**', kind: 'markdown' },
      'home.raw':      { value: '<em>raw</em>', kind: 'html' },
      'home.hero':     { value: '/assets/img/hero.jpg', kind: 'image' },
    },
    assets: { 'styles.css': 'styles.abc12345.css' },
  });
});

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('buildEnv filters', () => {
  it('"t" returns the value and is HTML-escaped by Nunjucks autoescape', () => {
    const out = env.render('simple.njk');
    expect(out).toBe('Hello &lt;world&gt;');
  });

  it('"tmd" renders markdown as trusted HTML', () => {
    const out = env.render('md.njk').trim();
    expect(out).toContain('<strong>bold</strong>');
  });

  it('"thtml" emits raw HTML without escaping', () => {
    const out = env.render('html.njk');
    expect(out).toContain('<em>raw</em>');
  });

  it('"timg" returns the URL verbatim', () => {
    const out = env.render('img.njk');
    expect(out).toContain('src="/assets/img/hero.jpg"');
  });

  it('renders a visible marker for missing content keys', () => {
    const out = env.render('missing.njk');
    expect(out).toContain('«never.set»');
    expect(out).toContain('missing-content');
  });

  it('"asset()" returns the hashed filename from the manifest', () => {
    const out = env.render('asset.njk');
    expect(out).toBe('/assets/styles.abc12345.css');
  });

  it('"asset()" falls back to the bare name when not in manifest', () => {
    const env2 = buildEnv({
      templatesDir: path.join(tmpDir, 'tpl'),
      content: {},
      assets: {},
    });
    expect(env2.render('asset.njk')).toBe('/assets/styles.css');
  });

  it('"hasContent" is true when key exists and is non-empty', () => {
    expect(env.render('has.njk')).toBe('yes');
  });

  it('"hasContent" is false for unset or empty keys', () => {
    const env2 = buildEnv({
      templatesDir: path.join(tmpDir, 'tpl'),
      content: { 'home.body': { value: '   ', kind: 'text' } },
      assets: {},
    });
    expect(env2.render('has.njk')).toBe('no');
  });
});

describe('editable mode', () => {
  function editEnv() {
    return buildEnv({
      templatesDir: path.join(tmpDir, 'tpl'),
      content: {
        'home.headline': { value: 'Hello <world>', kind: 'text' },
        'home.body':     { value: '**bold**', kind: 'markdown' },
        'home.raw':      { value: '<em>raw</em>', kind: 'html' },
        'home.hero':     { value: '/assets/img/hero.jpg', kind: 'image' },
      },
      assets: {},
      editable: true,
    });
  }

  it('"te" behaves exactly like "t" in the public (non-editable) build', () => {
    // Public build output must be byte-for-byte unchanged.
    expect(env.render('te.njk')).toBe(env.render('simple.njk'));
  });

  it('"te" wraps escaped text with edit metadata when editable', () => {
    const out = editEnv().render('te.njk');
    expect(out).toContain('data-mw-key="home.headline"');
    expect(out).toContain('data-mw-kind="text"');
    expect(out).toContain('Hello &lt;world&gt;'); // still escaped, not raw
  });

  it('"thtml" wraps raw HTML when editable', () => {
    const out = editEnv().render('html.njk');
    expect(out).toContain('class="mw-ed mw-ed-rich"');
    expect(out).toContain('data-mw-kind="html"');
    expect(out).toContain('<em>raw</em>');
  });

  it('records image keys on env.mwImages during an editable render', () => {
    const e = editEnv();
    e.render('img.njk');
    expect(e.mwImages).toContainEqual({ key: 'home.hero', value: '/assets/img/hero.jpg' });
  });
});

describe('writeAtomic', () => {
  it('writes the final file and leaves no .tmp- siblings', () => {
    const target = path.join(tmpDir, 'out', 'page.html');
    writeAtomic(target, '<html></html>');
    expect(fs.readFileSync(target, 'utf8')).toBe('<html></html>');
    const siblings = fs.readdirSync(path.dirname(target));
    expect(siblings.filter(n => n.startsWith('page.html.tmp-'))).toEqual([]);
  });

  it('overwrites an existing file', () => {
    const target = path.join(tmpDir, 'out2', 'page.html');
    writeAtomic(target, 'first');
    writeAtomic(target, 'second');
    expect(fs.readFileSync(target, 'utf8')).toBe('second');
  });
});
