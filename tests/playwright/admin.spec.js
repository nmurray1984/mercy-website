'use strict';

const { test, expect } = require('@playwright/test');

const ADMIN_EMAIL = 'admin@example.com';
const SUPERUSER_EMAIL = 'root@example.com';
const PASSWORD = 'correct-horse-battery-staple';

async function signIn(page, email = ADMIN_EMAIL, password = PASSWORD) {
  await page.goto('/admin/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin(\/|$|\?)/);
}

test.describe('Admin — unauthenticated', () => {
  test('login page renders', async ({ page }) => {
    const r = await page.goto('/admin/login');
    expect(r.status()).toBe(200);
    await expect(page.locator('h1')).toContainText(/sign in/i);
  });

  test('redirects to login when accessing /admin', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('rejects wrong credentials', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', 'wrong-pw-for-test');
    await page.click('button[type="submit"]');
    await expect(page.locator('.flash-error')).toBeVisible();
  });
});

test.describe('Admin — authenticated as admin', () => {
  test('dashboard loads after login', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/admin\/?$/);
    await expect(page.locator('body')).toContainText(/dashboard/i);
  });

  test('content list groups by page and section', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/content');
    await expect(page.locator('body')).toContainText('home.hero.headline');
    await expect(page.locator('body')).toContainText('visit.headline');
  });

  test('editing a content key saves and shows a flash', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/content/home.hero.headline');
    const textarea = page.locator('textarea[name="value"], input[name="value"]').first();
    await textarea.fill('Edited via Playwright');
    // The page has three submit buttons (Sign out, Rebuild, Save). Click the
    // Save one by name.
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.locator('.flash-info')).toContainText(/saved/i);

    // Reload and confirm the value persisted.
    await page.goto('/admin/content/home.hero.headline');
    const current = await page.locator('textarea[name="value"], input[name="value"]').first().inputValue();
    expect(current).toBe('Edited via Playwright');
  });

  test('admin cannot access /admin/users', async ({ page }) => {
    await signIn(page);
    const r = await page.goto('/admin/users');
    expect(r.status()).toBe(403);
  });

  test('logout drops the session', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin');
    // The dashboard has a logout form; submit it.
    const logoutForm = page.locator('form[action="/admin/logout"]');
    if (await logoutForm.count() > 0) {
      await logoutForm.locator('button[type="submit"]').click();
    } else {
      // Fall back to POST via fetch if the template doesn't render a button.
      await page.request.post('/admin/logout');
    }
    // Now /admin should redirect to login.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

test.describe('Admin — authenticated as superuser', () => {
  test('user list is visible', async ({ page }) => {
    await signIn(page, SUPERUSER_EMAIL);
    await page.goto('/admin/users');
    await expect(page.locator('body')).toContainText(ADMIN_EMAIL);
    await expect(page.locator('body')).toContainText(SUPERUSER_EMAIL);
  });
});
