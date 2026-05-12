'use strict';

const { findUserById } = require('../auth');

/**
 * Require a logged-in user. Attaches `req.user` for downstream handlers.
 * Redirects browsers to /admin/login; returns 401 JSON for API requests.
 */
function requireAuth(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) return denied(req, res);

  const user = findUserById(userId);
  if (!user || !user.is_active) {
    req.session.destroy(() => {});
    return denied(req, res);
  }
  req.user = user;
  next();
}

function isApi(req) {
  // baseUrl is the mount path of the router; for /api/* routes it begins with /api
  return (req.baseUrl || '').startsWith('/api/') || (req.originalUrl || '').startsWith('/api/');
}

function denied(req, res) {
  if (isApi(req)) {
    return res.status(401).json({ error: 'authentication required' });
  }
  const next = req.originalUrl && req.originalUrl !== '/admin/login'
    ? '?next=' + encodeURIComponent(req.originalUrl) : '';
  return res.redirect('/admin/login' + next);
}

function requireSuperuser(req, res, next) {
  if (!req.user || req.user.role !== 'superuser') {
    if (isApi(req)) {
      return res.status(403).json({ error: 'superuser required' });
    }
    return res.status(403).send('Forbidden — superuser only.');
  }
  next();
}

module.exports = { requireAuth, requireSuperuser };
