'use strict';

const { makeSandbox, cleanupSandbox } = require('../_helpers/sandbox');
const tmpRoot = makeSandbox();

const { migrate } = require('../../db/migrate');
migrate();

const auth = require('../../server/auth');
const db = require('../../server/db');
const { seedUsers, seedContent } = require('../_helpers/seed');
const { newAgent, apiLogin, apiPut, apiPost } = require('../_helpers/agent');

let app;
let seeded;

beforeAll(async () => {
  seeded = await seedUsers(db, auth);
  seedContent(db);
  app = require('../../server');
});

afterAll(() => cleanupSandbox(tmpRoot));

async function adminAgent() {
  const a = newAgent(app);
  const r = await apiLogin(a, seeded.admin.email, seeded.password);
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${r.text}`);
  return a;
}

describe('GET /api/content', () => {
  it('returns all rows for an authenticated user', async () => {
    const a = await adminAgent();
    const res = await a.get('/api/content');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
    const keys = res.body.map(r => r.key);
    expect(keys).toContain('home.hero.headline');
    expect(keys).toContain('visit.address');
  });
});

describe('GET /api/content/:key', () => {
  it('returns the row for an existing key', async () => {
    const a = await adminAgent();
    const res = await a.get('/api/content/home.hero.headline');
    expect(res.status).toBe(200);
    expect(res.body.key).toBe('home.hero.headline');
    expect(res.body.value).toContain('Mercy');
  });

  it('returns 404 for a missing key', async () => {
    const a = await adminAgent();
    const res = await a.get('/api/content/does.not.exist');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/content/:key', () => {
  it('updates the value and bumps updated_at', async () => {
    const a = await adminAgent();
    const before = await a.get('/api/content/home.hero.headline');
    const beforeStamp = before.body.updated_at;

    // Sleep so SQLite datetime('now') ticks; granularity is 1s.
    await new Promise(r => setTimeout(r, 1100));

    const res = await apiPut(a, '/api/content/home.hero.headline', { value: 'New headline' });
    expect(res.status).toBe(200);
    expect(res.body.value).toBe('New headline');
    expect(res.body.updated_at).not.toBe(beforeStamp);
    expect(res.body.updated_by).toBe(seeded.admin.id);
  });

  it('rejects an invalid kind with 400', async () => {
    const a = await adminAgent();
    const res = await apiPut(a, '/api/content/home.hero.headline', {
      value: 'ok', kind: 'pdf',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown key', async () => {
    const a = await adminAgent();
    const res = await apiPut(a, '/api/content/does.not.exist', { value: 'x' });
    expect(res.status).toBe(404);
  });

  it('rejects an anonymous request with 401', async () => {
    const a = newAgent(app);
    const res = await apiPut(a, '/api/content/home.hero.headline', { value: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('Revisions', () => {
  it('writes a revision row for each edit', async () => {
    const a = await adminAgent();
    await apiPut(a, '/api/content/visit.address', { value: 'A' });
    await new Promise(r => setTimeout(r, 1100));
    await apiPut(a, '/api/content/visit.address', { value: 'B' });

    const res = await a.get('/api/content/visit.address/revisions');
    expect(res.status).toBe(200);
    // Two edits since seed: each PUT inserts ONE revision (the pre-edit state).
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    // Revisions store the pre-edit value, so the most recent revision is the
    // value that was current right before this latest edit.
    const values = res.body.map(r => r.value);
    expect(values).toContain('A');
  });

  it('reverts to a previous revision', async () => {
    const a = await adminAgent();
    await apiPut(a, '/api/content/visit.address', { value: 'C' });
    const revs = await a.get('/api/content/visit.address/revisions');
    const target = revs.body[revs.body.length - 1]; // oldest revision: original seed
    expect(target).toBeTruthy();

    const res = await apiPost(a, `/api/content/visit.address/revert/${target.id}`, {});
    expect(res.status).toBe(200);
    expect(res.body.value).toBe(target.value);
  });

  it('returns 404 when reverting to a non-existent revision', async () => {
    const a = await adminAgent();
    const res = await apiPost(a, '/api/content/visit.address/revert/99999', {});
    expect(res.status).toBe(404);
  });
});
