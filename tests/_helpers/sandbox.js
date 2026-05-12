'use strict';

/**
 * Test sandbox: a fresh temp directory and env vars pointed at it. Call
 * `makeSandbox()` at the very top of a test file, BEFORE requiring any of
 * `server/*`, `db/*`, or `build/*`. Those modules cache config and a DB
 * handle at require-time, so the env must be set first.
 *
 * Vitest runs each test file in its own worker, so module caches don't leak
 * between files.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function makeSandbox() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mercy-test-'));
  process.env.DATABASE_PATH = path.join(tmpRoot, 'mercy.sqlite');
  process.env.PUBLIC_DIR = path.join(tmpRoot, 'public');
  process.env.UPLOAD_DIR = path.join(tmpRoot, 'uploads');
  process.env.COOKIE_SECURE = 'false';
  process.env.LOG_LEVEL = 'silent';
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'a'.repeat(64);
  process.env.CSRF_SECRET = 'b'.repeat(64);
  // Force a unique port if the server is started; integration tests use
  // supertest and don't bind a port, so this is mostly defensive.
  process.env.PORT = String(40000 + Math.floor(Math.random() * 20000));
  return tmpRoot;
}

function cleanupSandbox(tmpRoot) {
  if (!tmpRoot) return;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_e) {
    // Best-effort. Windows sometimes holds onto sqlite-wal briefly.
  }
}

module.exports = { makeSandbox, cleanupSandbox };
