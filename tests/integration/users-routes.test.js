'use strict';

const { makeSandbox, cleanupSandbox } = require('../_helpers/sandbox');
const tmpRoot = makeSandbox();

const { migrate } = require('../../db/migrate');
migrate();

const auth = require('../../server/auth');
const db = require('../../server/db');
const { seedUsers } = require('../_helpers/seed');
const { newAgent, apiLogin, apiPost, apiPut, apiDelete } = require('../_helpers/agent');

let app;
let seeded;

beforeAll(async () => {
  seeded = await seedUsers(db, auth);
  app = require('../../server');
});

afterAll(() => cleanupSandbox(tmpRoot));

async function loginAs(user) {
  const a = newAgent(app);
  const r = await apiLogin(a, user.email, seeded.password);
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return a;
}

describe('GET /api/users (superuser only)', () => {
  it('returns 403 for an admin', async () => {
    const a = await loginAs(seeded.admin);
    const res = await a.get('/api/users');
    expect(res.status).toBe(403);
  });

  it('returns the user list for a superuser', async () => {
    const a = await loginAs(seeded.superuser);
    const res = await a.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0]).toHaveProperty('email');
    expect(res.body[0]).not.toHaveProperty('password_hash');
  });
});

describe('POST /api/users (superuser only)', () => {
  it('creates a new user', async () => {
    const a = await loginAs(seeded.superuser);
    const res = await apiPost(a, '/api/users', {
      email: 'newperson@example.com',
      role: 'admin',
      password: 'correct-horse-battery-staple',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'newperson@example.com', role: 'admin' });
    expect(auth.findUserByEmail('newperson@example.com')).toBeTruthy();
  });

  it('rejects a duplicate email', async () => {
    const a = await loginAs(seeded.superuser);
    const res = await apiPost(a, '/api/users', {
      email: seeded.admin.email,
      role: 'admin',
      password: 'correct-horse-battery-staple',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a too-short password', async () => {
    const a = await loginAs(seeded.superuser);
    const res = await apiPost(a, '/api/users', {
      email: 'shortpw@example.com',
      role: 'admin',
      password: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 when an admin tries to create a user', async () => {
    const a = await loginAs(seeded.admin);
    const res = await apiPost(a, '/api/users', {
      email: 'nope@example.com',
      role: 'admin',
      password: 'correct-horse-battery-staple',
    });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/users/:id (superuser only)', () => {
  it('updates a user role', async () => {
    const target = await auth.createUser({
      email: 'promotable@example.com',
      password: 'correct-horse-battery-staple',
      role: 'admin',
    });
    const a = await loginAs(seeded.superuser);
    const res = await apiPut(a, `/api/users/${target.id}`, { role: 'superuser' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('superuser');
  });

  it('refuses to demote the last active superuser', async () => {
    // Ensure only one active superuser exists. Deactivate any others.
    db.prepare(`UPDATE users SET is_active = 0
                WHERE role = 'superuser' AND id != ?`).run(seeded.superuser.id);

    const a = await loginAs(seeded.superuser);
    const res = await apiPut(a, `/api/users/${seeded.superuser.id}`, { role: 'admin' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/last active superuser/i);

    // Restore other superusers for later tests.
    db.prepare(`UPDATE users SET is_active = 1 WHERE role = 'superuser'`).run();
  });
});

describe('POST /api/users/:id/password (self or superuser)', () => {
  it('lets a user change their own password', async () => {
    const a = await loginAs(seeded.admin);
    const res = await apiPost(a, `/api/users/${seeded.admin.id}/password`, {
      password: 'new-long-password-123',
    });
    expect(res.status).toBe(200);

    // The new password works for login.
    const a2 = newAgent(app);
    const r = await apiLogin(a2, seeded.admin.email, 'new-long-password-123');
    expect(r.status).toBe(200);

    // Restore the original password so other tests keep working — log in
    // with the NEW password first, then change it back.
    await apiPost(a2, `/api/users/${seeded.admin.id}/password`, { password: seeded.password });
  });

  it('rejects a too-short new password', async () => {
    const a = await loginAs(seeded.admin);
    const res = await apiPost(a, `/api/users/${seeded.admin.id}/password`, { password: 'short' });
    expect(res.status).toBe(400);
  });

  it('forbids an admin from changing another user\'s password', async () => {
    const other = await auth.createUser({
      email: 'other@example.com',
      password: 'correct-horse-battery-staple',
      role: 'admin',
    });
    const a = await loginAs(seeded.admin);
    const res = await apiPost(a, `/api/users/${other.id}/password`, {
      password: 'tries-to-hijack-pw',
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/users/:id (superuser only)', () => {
  it('refuses to delete the last active superuser', async () => {
    db.prepare(`UPDATE users SET is_active = 0
                WHERE role = 'superuser' AND id != ?`).run(seeded.superuser.id);

    const a = await loginAs(seeded.superuser);
    const res = await apiDelete(a, `/api/users/${seeded.superuser.id}`);
    expect(res.status).toBe(409);

    db.prepare(`UPDATE users SET is_active = 1 WHERE role = 'superuser'`).run();
  });

  it('deletes another user', async () => {
    const victim = await auth.createUser({
      email: 'victim@example.com',
      password: 'correct-horse-battery-staple',
      role: 'admin',
    });
    const a = await loginAs(seeded.superuser);
    const res = await apiDelete(a, `/api/users/${victim.id}`);
    expect(res.status).toBe(204);
    expect(auth.findUserById(victim.id)).toBeUndefined();
  });
});
