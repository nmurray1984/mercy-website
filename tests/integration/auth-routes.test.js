'use strict';

const { makeSandbox, cleanupSandbox } = require('../_helpers/sandbox');
const tmpRoot = makeSandbox();

const { migrate } = require('../../db/migrate');
migrate();

const auth = require('../../server/auth');
const db = require('../../server/db');
const { seedUsers } = require('../_helpers/seed');
const { newAgent, csrfToken, apiLogin, apiPost } = require('../_helpers/agent');

let app;
let seeded;

beforeAll(async () => {
  seeded = await seedUsers(db, auth);
  app = require('../../server');
});

afterAll(() => cleanupSandbox(tmpRoot));

describe('POST /api/auth/login', () => {
  it('rejects missing credentials with 400', async () => {
    const agent = newAgent(app);
    const token = await csrfToken(agent);
    const res = await agent
      .post('/api/auth/login')
      .set('x-csrf-token', token)
      .set('Accept', 'application/json')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('rejects an unknown email with 401', async () => {
    const agent = newAgent(app);
    const res = await apiLogin(agent, 'nobody@example.com', 'whatever-long-pw');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong password with 401', async () => {
    const agent = newAgent(app);
    const res = await apiLogin(agent, seeded.admin.email, 'wrong-password-here');
    expect(res.status).toBe(401);
  });

  it('accepts a correct password and sets a session cookie', async () => {
    const agent = newAgent(app);
    const res = await apiLogin(agent, seeded.admin.email, seeded.password);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: seeded.admin.email, role: 'admin' });
    const setCookie = res.headers['set-cookie'].join(';');
    expect(setCookie).toMatch(/mercy\.sid=/);
  });

  it('clears failed_attempts on success', async () => {
    db.prepare('UPDATE users SET failed_attempts = 3 WHERE id = ?').run(seeded.admin.id);
    const agent = newAgent(app);
    await apiLogin(agent, seeded.admin.email, seeded.password);
    const u = auth.findUserById(seeded.admin.id);
    expect(u.failed_attempts).toBe(0);
  });
});

describe('CSRF', () => {
  it('rejects state-changing requests without a token', async () => {
    const agent = newAgent(app);
    const res = await agent
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'whatever' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/csrf/i);
  });
});

describe('Lockout', () => {
  it('locks an account after 5 failed attempts and rejects with 401 thereafter', async () => {
    const u = await auth.createUser({
      email: 'lockme@example.com',
      password: 'correct-horse-battery-staple',
      role: 'admin',
    });

    const agent = newAgent(app);
    for (let i = 0; i < 5; i++) {
      const r = await apiLogin(agent, u.email, 'bad-password-attempt');
      expect(r.status).toBe(401);
    }

    const after = auth.findUserById(u.id);
    expect(after.failed_attempts).toBeGreaterThanOrEqual(5);
    expect(after.locked_until).not.toBeNull();

    // Even with the correct password, the account is locked.
    const r = await apiLogin(agent, u.email, 'correct-horse-battery-staple');
    expect(r.status).toBe(401);
  });
});

describe('Authenticated routes', () => {
  it('rejects /api/content for an unauthenticated request', async () => {
    const agent = newAgent(app);
    const res = await agent.get('/api/content');
    expect(res.status).toBe(401);
  });

  it('allows /api/content after login', async () => {
    const agent = newAgent(app);
    const login = await apiLogin(agent, seeded.admin.email, seeded.password);
    expect(login.status).toBe(200);
    const res = await agent.get('/api/content');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/auth/logout', () => {
  it('destroys the session', async () => {
    const agent = newAgent(app);
    await apiLogin(agent, seeded.admin.email, seeded.password);
    const r1 = await agent.get('/api/content');
    expect(r1.status).toBe(200);

    const out = await apiPost(agent, '/api/auth/logout', {});
    expect([200, 204]).toContain(out.status);

    const r2 = await agent.get('/api/content');
    expect(r2.status).toBe(401);
  });
});
