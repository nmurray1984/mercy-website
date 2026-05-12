'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const db = new Database(config.databasePath);
try { db.pragma('journal_mode = WAL'); } catch (_e) { db.pragma('journal_mode = DELETE'); }
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

module.exports = db;
