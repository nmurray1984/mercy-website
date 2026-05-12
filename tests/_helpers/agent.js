'use strict';

/**
 * Supertest helpers for working with the CSRF-protected admin app.
 *
 * The server uses csrf-csrf double-submit. To make a state-changing request
 * we need (a) a `mercy.csrf` cookie and (b) a matching token in the body or
 * an `x-csrf-token` header. Both are produced by hitting a GET route that
 * calls `req.csrfToken()`.
 *
 *   const a = newAgent(app);
 *   const token = await csrfToken(a);
 *   await apiLogin(a, 'admin@example.com', 'pw');
 *   await apiPut(a, '/api/content/some.key', { value: 'x' });
 */

const request = require('supertest');

function newAgent(app) {
  return request.agent(app);
}

// Pull the CSRF token out of the rendered login form HTML.
async function csrfToken(agent) {
  const res = await agent.get('/admin/login').expect(200);
  const m = res.text.match(/name="_csrf"[^>]*value="([^"]+)"/);
  if (!m) {
    throw new Error('CSRF token not found in login page HTML');
  }
  return m[1];
}

async function apiLogin(agent, email, password) {
  const token = await csrfToken(agent);
  return agent
    .post('/api/auth/login')
    .set('x-csrf-token', token)
    .set('Accept', 'application/json')
    .send({ email, password });
}

async function apiPost(agent, url, body) {
  const token = await csrfToken(agent);
  return agent.post(url)
    .set('x-csrf-token', token)
    .set('Accept', 'application/json')
    .send(body || {});
}

async function apiPut(agent, url, body) {
  const token = await csrfToken(agent);
  return agent.put(url)
    .set('x-csrf-token', token)
    .set('Accept', 'application/json')
    .send(body || {});
}

async function apiDelete(agent, url) {
  const token = await csrfToken(agent);
  return agent.delete(url)
    .set('x-csrf-token', token)
    .set('Accept', 'application/json');
}

module.exports = {
  newAgent,
  csrfToken,
  apiLogin,
  apiPost,
  apiPut,
  apiDelete,
};
