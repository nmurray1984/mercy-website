'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');
const nunjucks = require('nunjucks');
const pinoHttp = require('pino-http');
const Database = require('better-sqlite3');
const flash = require('connect-flash');

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const { requireAuth, requireSuperuser } = require('./middleware/requireAuth');

const authRoutes = require('./routes/auth');
const contentRoutes = require('./routes/content');
const usersRoutes = require('./routes/users');
const buildRoutes = require('./routes/build');
const mediaRoutes = require('./routes/media');

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

// Nunjucks for admin views.
const njk = nunjucks.configure(path.join(__dirname, 'views'), {
  autoescape: true,
  noCache: config.env === 'development',
  express: app,
});
app.set('view engine', 'njk');

// Static admin assets (small).
app.use('/admin/static', express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
}));

// Logging.
app.use(pinoHttp({
  level: config.logLevel,
  redact: ['req.headers.cookie', 'res.headers["set-cookie"]'],
  serializers: {
    req(req) { return { id: req.id, method: req.method, url: req.url, ip: req.ip }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
}));

// Build CSP directives explicitly (don't rely on helmet defaults) so we can
// keep upgrade-insecure-requests out of local http dev.
const cspDirectives = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "https:"],
  "font-src": ["'self'", "https:", "data:"],
  "connect-src": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
};
if (config.cookieSecure) {
  cspDirectives["upgrade-insecure-requests"] = [];
}

app.use(helmet({
  strictTransportSecurity: config.cookieSecure ? undefined : false,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: cspDirectives,
  },
}));

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(cookieParser(config.sessionSecret));

// Sessions — backed by SQLite so they survive restarts and there's no extra
// process to manage.
const sessionDb = new Database(config.databasePath);
try { sessionDb.pragma('journal_mode = WAL'); } catch (_e) {}

app.use(session({
  name: 'mercy.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new SqliteStore({
    client: sessionDb,
    expired: { clear: true, intervalMs: 15 * 60 * 1000 },
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionIdleSeconds * 1000,
  },
}));

app.use(flash());

// CSRF via double-submit cookie.
// The `__Host-` prefix requires Secure cookies, so only use it in production.
const csrfCookieName = config.cookieSecure ? '__Host-mercy.csrf' : 'mercy.csrf';
const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => config.csrfSecret,
  getSessionIdentifier: (req) => (req.session && req.session.id) || req.ip,
  cookieName: csrfCookieName,
  cookieOptions: {
    sameSite: 'lax',
    secure: config.cookieSecure,
    httpOnly: true,
    path: '/',
  },
  size: 32,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) =>
    (req.body && req.body._csrf) ||
    (req.query && req.query._csrf) ||
    req.get('x-csrf-token'),
});

// Expose a token-getter on the request and locals for templates.
// Pass overwrite=true so the cookie is always regenerated to match the
// current session identifier. This avoids stale-cookie failures after
// session.regenerate() on login.
app.use((req, res, next) => {
  let cached = null;
  req.csrfToken = () => {
    if (cached) return cached;
    cached = generateToken(req, res, true, false);
    return cached;
  };
  res.locals.csrfToken = req.csrfToken;
  res.locals.flash = {
    info: req.flash('info'),
    error: req.flash('error'),
  };
  res.locals.user = null;
  res.locals.nav = '';
  if (req.session && req.session.userId) {
    const u = auth.findUserById(req.session.userId);
    if (u && u.is_active) res.locals.user = u;
  }
  // Pick a nav highlight from the path
  const p = req.path;
  if (p === '/admin' || p === '/admin/') res.locals.nav = 'dashboard';
  else if (p.startsWith('/admin/content')) res.locals.nav = 'content';
  else if (p.startsWith('/admin/media')) res.locals.nav = 'media';
  else if (p.startsWith('/admin/users')) res.locals.nav = 'users';
  else if (p.startsWith('/admin/account')) res.locals.nav = 'account';
  next();
});

// Health check (no auth).
app.get('/healthz', (req, res) => res.json({ ok: true }));

// /admin/login — GET is unauthenticated.
app.get('/admin/login', (req, res) => {
  res.render('login', {
    title: 'Sign in',
    error: req.flash('error')[0] || null,
    email: '',
    next: req.query.next || '',
    csrfToken: req.csrfToken(),
  });
});

// CSRF protection on state-changing routes only.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return doubleCsrfProtection(req, res, next);
});

// Auth routes are mounted at both /api/auth (JSON) and /admin via the same router.
app.use('/api/auth', authRoutes);
app.use('/admin', authRoutes); // shares POST /login and POST /logout

// Admin page routes (server-rendered).
require('./adminPages')(app);

// JSON API routes (require auth via routers).
app.use('/api/content', contentRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/build', buildRoutes);
app.use('/api/media', mediaRoutes);

// Public site — Node serves the flat files built by `npm run build` directly
// from the publicDir. No nginx, no per-request rendering: sendFile() only.
// Hashed asset filenames get a long cache; HTML gets a short cache so edits
// after a rebuild are visible within ~5 minutes.
app.use('/assets', express.static(path.join(config.publicDir, 'assets'), {
  immutable: true,
  maxAge: '365d',
  fallthrough: true,
}));

app.use(express.static(config.publicDir, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  },
  fallthrough: true,
}));

// Pretty URLs: /visit → public/visit/index.html. Only matches paths without a
// dot, so /assets/foo.css falls through to the static handler above.
app.get(/^\/[^.]*$/, (req, res, next) => {
  const candidate = path.join(config.publicDir, req.path, 'index.html');
  fs.access(candidate, err => {
    if (err) return next();
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(candidate);
  });
});

// Default error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  req.log && req.log.error({ err }, 'unhandled');
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'invalid or missing CSRF token' });
  }
  if (req.accepts('html') && !req.path.startsWith('/api/')) {
    return res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
  }
  res.status(500).json({ error: 'internal' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`mercy admin listening on http://127.0.0.1:${config.port}`);
  });
}

module.exports = app;
