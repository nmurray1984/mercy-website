#!/usr/bin/env node
'use strict';

/**
 * Apply migrations from db/migrations/*.sql in lexical order.
 * Tracks applied migrations in a `schema_migrations` table.
 * Idempotent — safe to run on every deploy.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../server/config');

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function migrate() {
  ensureDir(config.databasePath);
  const db = new Database(config.databasePath);
  // WAL is preferred on a real filesystem; on some shared/FUSE mounts in dev it
  // surfaces as "disk I/O error". Try WAL, fall back to DELETE journal.
  try { db.pragma('journal_mode = WAL'); } catch (_e) { db.pragma('journal_mode = DELETE'); }
  db.pragma('foreign_keys = ON');

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  const insertApplied = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  let n = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      insertApplied.run(file);
    });
    tx();
    console.log(`applied: ${file}`);
    n++;
  }

  if (n === 0) console.log('migrations up to date');
  db.close();
}

if (require.main === module) {
  try {
    migrate();
  } catch (e) {
    console.error('migration failed:', e.message);
    process.exit(1);
  }
}

module.exports = { migrate };
