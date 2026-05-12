'use strict';

const { test, expect } = require('@playwright/test');

const PUBLIC_PAGES = [
  { path: '/',        title: /Mercy/i,    contains: 'Mercy to us' },
  { path: '/visit',   title: /Visit/i,    contains: '123 Mercy Lane' },
  { path: '/about',   title: /About/i,    contains: null },
  { path: '/sermons', title: /Sermons/i,  contains: null },
  { path: '/groups',  title: /Groups/i,   contains: null },
  { path: '/events',  title: /Events/i,   contains: null },
  { path: '/give',    title: /Give/i,     contains: null },
];

test.describe('Public site', () => {
  for (const p of PUBLIC_PAGES) {
    test(`renders ${p.path}`, async ({ page }) => {
      const response = await page.goto(p.path);
      expect(response.status()).toBe(200);
      await expect(page).toHaveTitle(p.title);
      if (p.contains) {
        await expect(page.locator('body')).toContainText(p.contains);
      }
    });
  }

  test('hashed stylesheet returns 200', async ({ page }) => {
    await page.goto('/');
    const cssHref = await page.getAttribute('link[rel="stylesheet"]', 'href');
    expect(cssHref).toMatch(/\/assets\/styles\.[a-f0-9]{8}\.css$/);
    const r = await page.request.get(cssHref);
    expect(r.status()).toBe(200);
  });

  test('unknown path returns 404', async ({ page }) => {
    const r = await page.goto('/does-not-exist', { waitUntil: 'domcontentloaded' });
    expect(r.status()).toBe(404);
  });

  test('site title in the home page <title>', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title).toContain('Mercy Presbyterian');
  });
});
