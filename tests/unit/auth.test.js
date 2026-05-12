'use strict';

const { makeSandbox, cleanupSandbox } = require('../_helpers/sandbox');
const tmpRoot = makeSandbox();

const { migrate } = require('../../db/migrate');
migrate();
const auth = require('../../server/auth');
const db = require('../../server/db');

afterAll(() => cleanupSandbox(tmpRoot));

describe('auth.validatePassword', () => {
  it('rejects passwords shorter than 12 characters', () => {
    expect(auth.validatePassword('short')).toMatch(/at least 12/);
    expect(auth.validatePassword('eleven-chrs')).toMatch(/at least 12/);
  });

  it('rejects non-strings', () => {
    expect(auth.validatePassword(undefined)).toMatch(/required/i);
    expect(auth.validatePassword(12345678901234)).toMatch(/required/i);
  });

  it('rejects common passwords case-insensitively', () => {
    // Only common passwords at least 12 chars long actually reach the
    // common-list check; anything shorter is rejected on length first.
    expect(auth.validatePassword('mercypresbyterian')).toMatch(/too common/i);
    expect(auth.validatePassword('MercyPresbyterian')).toMatch(/too common/i);
  });

  it('accepts a long uncommon password', () => {
    expect(auth.validatePassword('correct-horse-battery-staple')).toBe(null);
  });
});

describe('auth.hashPassword + verifyPassword', () => {
  it('produces a bcrypt hash that verifies for the correct password', async () => {
    const hash = await auth.hashPassword('correct-horse-battery-staple');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await auth.verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('returns false for the wrong password', async () => {
    const hash = await auth.hashPassword('correct-horse-battery-staple');
    expect(await auth.verifyPassword('wrong-password!', hash)).toBe(false);
  });
});

describe('auth.createUser', () => {
  it('persists a user with hashed password and lower-cased email', async () => {
    const u = await auth.createUser({
      email: '  Test@Example.COM ',
      password: 'correct-horse-battery-staple',
      role: 'admin',
    });
    expect(u.email).toBe('test@example.com');
    expect(u.password_hash).not.toBe('correct-horse-battery-staple');
    expect(u.role).toBe('admin');
    expect(u.is_active).toBe(1);
  });

  it('rejects invalid roles', async () => {
    await expect(auth.createUser({
      email: 'a@b.com', password: 'correct-horse-battery-staple', role: 'root',
    })).rejects.toThrow(/role/i);
  });

  it('refuses a too-short password', async () => {
    await expect(auth.createUser({
      email: 'short@b.com', password: 'short', role: 'admin',
    })).rejects.toThrow(/12 characters/i);
  });
});

describe('auth.isLocked', () => {
  it('returns false when locked_until is null', () => {
    expect(auth.isLocked({ locked_until: null })).toBe(false);
  });

  it('returns true when locked_until is in the future', () => {
    const future = new Date(Date.now() + 60_000)
      .toISOString().slice(0, 19).replace('T', ' ');
    expect(auth.isLocked({ locked_until: future })).toBe(true);
  });

  it('returns false when locked_until is in the past', () => {
    const past = new Date(Date.now() - 60_000)
      .toISOString().slice(0, 19).replace('T', ' ');
    expect(auth.isLocked({ locked_until: past })).toBe(false);
  });
});

describe('auth.recordFailedLogin', () => {
  let user;
  beforeAll(async () => {
    user = await auth.createUser({
      email: 'lockme@example.com',
      password: 'correct-horse-battery-staple',
      role: 'admin',
    });
  });

  it('increments failed_attempts and locks after 5 failures', () => {
    let current = auth.findUserById(user.id);
    for (let i = 0; i < 4; i++) {
      auth.recordFailedLogin(current);
      current = auth.findUserById(user.id);
    }
    expect(current.failed_attempts).toBe(4);
    expect(current.locked_until).toBeNull();

    auth.recordFailedLogin(current);
    current = auth.findUserById(user.id);
    expect(current.failed_attempts).toBe(5);
    expect(current.locked_until).not.toBeNull();
    expect(auth.isLocked(current)).toBe(true);
  });
});

describe('auth.recordSuccessfulLogin', () => {
  it('clears lockout and updates last_login_at', async () => {
    const u = await auth.createUser({
      email: 'success@example.com',
      password: 'correct-horse-battery-staple',
      role: 'admin',
    });
    db.prepare(`UPDATE users SET failed_attempts = 3, locked_until = '2099-01-01 00:00:00' WHERE id = ?`)
      .run(u.id);

    auth.recordSuccessfulLogin({ id: u.id });
    const after = auth.findUserById(u.id);
    expect(after.failed_attempts).toBe(0);
    expect(after.locked_until).toBeNull();
    expect(after.last_login_at).not.toBeNull();
  });
});

describe('auth.countOtherActiveSuperusers', () => {
  it('counts active superusers excluding the given id', async () => {
    const a = await auth.createUser({
      email: 'su1@example.com', password: 'correct-horse-battery-staple', role: 'superuser',
    });
    const b = await auth.createUser({
      email: 'su2@example.com', password: 'correct-horse-battery-staple', role: 'superuser',
    });
    // Make `b` inactive so it should not be counted.
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(b.id);

    // Counting "others, excluding a" — only b exists and b is inactive, so 0.
    expect(auth.countOtherActiveSuperusers(a.id)).toBe(0);

    // Reactivate b and count others excluding a — now 1.
    db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(b.id);
    expect(auth.countOtherActiveSuperusers(a.id)).toBe(1);
  });
});
