'use strict';

const path = require('path');
const { makeSandbox, cleanupSandbox } = require('../_helpers/sandbox');
const tmpRoot = makeSandbox();

afterAll(() => cleanupSandbox(tmpRoot));

describe('server/config', () => {
  it('resolves DATABASE_PATH and PUBLIC_DIR from env', () => {
    const config = require('../../server/config');
    expect(config.databasePath).toBe(path.join(tmpRoot, 'mercy.sqlite'));
    expect(config.publicDir).toBe(path.join(tmpRoot, 'public'));
  });

  it('reads NODE_ENV', () => {
    const config = require('../../server/config');
    expect(config.env).toBe('test');
  });

  it('parses cookieSecure as boolean', () => {
    const config = require('../../server/config');
    expect(config.cookieSecure).toBe(false);
  });

  it('exposes a numeric port', () => {
    const config = require('../../server/config');
    expect(typeof config.port).toBe('number');
    expect(Number.isFinite(config.port)).toBe(true);
  });

  it('falls back to default sessionIdleSeconds when env is unset', () => {
    delete process.env.SESSION_IDLE_SECONDS;
    // Clear module cache for a clean re-require.
    delete require.cache[require.resolve('../../server/config')];
    const config = require('../../server/config');
    expect(config.sessionIdleSeconds).toBe(12 * 60 * 60);
  });
});
