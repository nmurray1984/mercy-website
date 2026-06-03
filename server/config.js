'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const ROOT = path.resolve(__dirname, '..');

function bool(v, fallback) {
  if (v === undefined || v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const cookieSecure = bool(process.env.COOKIE_SECURE, false);

const config = {
  rootDir: ROOT,
  databasePath: path.resolve(ROOT, process.env.DATABASE_PATH || 'data/mercy.sqlite'),
  publicDir: path.resolve(ROOT, process.env.PUBLIC_DIR || 'public'),
  siteDir: path.resolve(ROOT, 'site'),
  uploadDir: path.resolve(ROOT, process.env.UPLOAD_DIR || 'site/assets/img/uploads'),
  port: num(process.env.PORT, 3000),
  sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production-this-is-insecure',
  csrfSecret: process.env.CSRF_SECRET || 'change-me-too-in-production-this-is-insecure',
  cookieSecure,
  sessionIdleSeconds: num(process.env.SESSION_IDLE_SECONDS, 12 * 60 * 60),
  // Secure cookies require Express to recognize the (TLS-terminating) proxy as
  // trusted; otherwise express-session silently drops the session cookie and
  // logins fail with "invalid csrf token". Default to trusting the first hop
  // whenever cookies are secure, so this can't break if TRUST_PROXY is unset.
  trustProxy: num(process.env.TRUST_PROXY, cookieSecure ? 1 : 0),
  logLevel: process.env.LOG_LEVEL || 'info',
  env: process.env.NODE_ENV || 'development',
};

module.exports = config;
