'use strict';

const { makeSandbox, cleanupSandbox } = require('../_helpers/sandbox');
const tmpRoot = makeSandbox();

const { migrate } = require('../../db/migrate');
migrate();

const auth = require('../../server/auth');
const db = require('../../server/db');
const { seedUsers, seedContent } = require('../_helpers/seed');
const { newAgent, apiLogin, apiPost } = require('../_helpers/agent');

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
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return a;
}

function waitForBuild(buildId, agent, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(async (resolve, reject) => {
    while (Date.now() < deadline) {
      const res = await agent.get(`/api/build/${buildId}`);
      if (res.status !== 200) return reject(new Error(`status ${res.status}`));
      if (res.body.status === 'ok' || res.body.status === 'error') {
        return resolve(res.body);
      }
      await new Promise(r => setTimeout(r, 100));
    }
    reject(new Error('build did not finish in time'));
  });
}

describe('POST /api/build', () => {
  it('rejects unauthenticated requests', async () => {
    const a = newAgent(app);
    const res = await apiPost(a, '/api/build', {});
    expect(res.status).toBe(401);
  });

  it('starts a build and returns a 202 with a buildId', async () => {
    const a = await adminAgent();
    const res = await apiPost(a, '/api/build', {});
    expect(res.status).toBe(202);
    expect(res.body.buildId).toBeGreaterThan(0);

    const finished = await waitForBuild(res.body.buildId, a);
    expect(finished.status).toBe('ok');
    expect(finished.log).toMatch(/Built \d+ pages/);
  });

  it('exposes the latest build', async () => {
    const a = await adminAgent();
    // Trigger a fresh build and wait for it.
    const start = await apiPost(a, '/api/build', {});
    if (start.status === 202) {
      await waitForBuild(start.body.buildId, a);
    }
    const res = await a.get('/api/build/latest');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(['ok', 'error', 'running']).toContain(res.body.status);
  });
});
