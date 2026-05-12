'use strict';

const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TMP_ROOT = path.join(__dirname, 'tests', '.playwright-tmp');

module.exports = defineConfig({
  testDir: './tests/playwright',
  testMatch: /.*\.spec\.js/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalSetup: require.resolve('./tests/playwright/global-setup.js'),
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node server/index.js',
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATABASE_PATH: path.join(TMP_ROOT, 'mercy.sqlite'),
      PUBLIC_DIR: path.join(TMP_ROOT, 'public'),
      UPLOAD_DIR: path.join(TMP_ROOT, 'uploads'),
      SESSION_SECRET: 'a'.repeat(64),
      CSRF_SECRET: 'b'.repeat(64),
      COOKIE_SECURE: 'false',
      LOG_LEVEL: 'silent',
    },
  },
});
