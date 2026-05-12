'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  findUserByEmail,
  verifyPassword,
  isLocked,
  recordFailedLogin,
  recordSuccessfulLogin,
} = require('../auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a minute.' },
  // In the test env every request shares the loopback IP, so the limiter
  // would block legitimate test traffic. Per-IP throttling stays active in
  // every other environment.
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return respond(req, res, 400, 'Email and password are required.', null);
  }

  const user = findUserByEmail(email);
  // Always run bcrypt to avoid timing oracle, even if user is missing.
  const ok = user
    ? !isLocked(user) && user.is_active && await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, '$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinv');

  if (!user || !ok) {
    if (user) recordFailedLogin(user);
    return respond(req, res, 401, 'Email or password is incorrect.', null);
  }

  if (isLocked(user)) {
    return respond(req, res, 423, 'This account is temporarily locked. Try again later.', null);
  }

  recordSuccessfulLogin(user);
  req.session.regenerate(err => {
    if (err) return respond(req, res, 500, 'Could not start a session.', null);
    req.session.userId = user.id;
    req.session.role = user.role;
    return respond(req, res, 200, null, { id: user.id, email: user.email, role: user.role });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('mercy.sid');
    if (req.accepts('html')) return res.redirect('/admin/login');
    return res.status(204).end();
  });
});

function respond(req, res, status, message, payload) {
  if (req.accepts('html') && !req.is('application/json')) {
    if (status === 200 || status === 204) {
      const next = (req.query.next && req.query.next.startsWith('/admin')) ? req.query.next : '/admin';
      return res.redirect(next);
    }
    return res.status(status).render('login', {
      title: 'Sign in',
      error: message,
      email: (req.body && req.body.email) || '',
      next: req.query.next || '',
      csrfToken: req.csrfToken && req.csrfToken(),
    });
  }
  return res.status(status).json(payload || { error: message });
}

module.exports = router;
