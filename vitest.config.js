'use strict';

const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    exclude: ['node_modules/**', 'tests/playwright/**'],
    // Exposes describe/it/expect/before*/after* as globals so test files can
    // stay CJS (the project is CJS — importing from 'vitest' via require()
    // is not supported).
    globals: true,
    // Each test file gets its own process. Required because server/db.js is a
    // CJS singleton tied to DATABASE_PATH at require time, and each file uses
    // its own temp database.
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    isolate: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    reporters: ['default'],
  },
});
