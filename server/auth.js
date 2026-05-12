'use strict';

const bcrypt = require('bcrypt');
const db = require('./db');

const BCRYPT_COST = 12;
const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 15;
const MIN_PASSWORD_LENGTH = 12;

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '123456789', 'qwerty',
  'qwerty123', 'letmein', 'welcome', 'welcome1', 'admin', 'admin123',
  'mercydallas', 'mercypresbyterian', 'changeme', 'iloveyou', 'monkey',
  'football', 'baseball', 'jesusisking', 'godlovesyou'
]);

function isCommon(password) {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (isCommon(password)) {
    return 'That password is too common. Pick something unguessable.';
  }
  return null;
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function isLocked(user) {
  if (!user.locked_until) return false;
  return new Date(user.locked_until + 'Z') > new Date();
}

function recordFailedLogin(user) {
  const next = (user.failed_attempts || 0) + 1;
  let lockedUntil = null;
  if (next >= MAX_FAILED) {
    const d = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    lockedUntil = d.toISOString().slice(0, 19).replace('T', ' ');
  }
  db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
    .run(next, lockedUntil, user.id);
}

function recordSuccessfulLogin(user) {
  db.prepare(`UPDATE users
              SET failed_attempts = 0, locked_until = NULL,
                  last_login_at = datetime('now')
              WHERE id = ?`).run(user.id);
}

/**
 * Count the number of active superusers, excluding a given user id.
 * Used to prevent locking the system out by demoting/deactivating the
 * last superuser.
 */
function countOtherActiveSuperusers(excludingId) {
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'superuser' AND is_active = 1 AND id != ?"
  ).get(excludingId);
  return row.n;
}

async function createUser({ email, password, role }) {
  if (!['admin', 'superuser'].includes(role)) {
    throw new Error('Invalid role');
  }
  const err = validatePassword(password);
  if (err) throw new Error(err);
  const hash = await hashPassword(password);
  const result = db.prepare(
    'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)'
  ).run(email.toLowerCase().trim(), hash, role);
  return findUserById(result.lastInsertRowid);
}

module.exports = {
  BCRYPT_COST,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
  validatePassword,
  findUserByEmail,
  findUserById,
  isLocked,
  recordFailedLogin,
  recordSuccessfulLogin,
  countOtherActiveSuperusers,
  createUser,
};
