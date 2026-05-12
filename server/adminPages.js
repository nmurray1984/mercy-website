'use strict';

/**
 * Admin pages — server-rendered Nunjucks. All require auth.
 * Pages POST through HTML forms (CSRF-protected); the same actions are also
 * available over the JSON API.
 */

const path = require('path');
const fs = require('fs');
const db = require('./db');
const auth = require('./auth');
const config = require('./config');
const { requireAuth, requireSuperuser } = require('./middleware/requireAuth');
const { build } = require('../build/build');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');

module.exports = function mountAdmin(app) {
  app.use('/admin', requireAuth);

  app.get('/admin', (req, res) => {
    const lastBuild = db.prepare(`SELECT * FROM builds ORDER BY id DESC LIMIT 1`).get();
    const contentCount = db.prepare(`SELECT COUNT(*) AS n FROM content`).get().n;
    const userCount = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_active = 1`).get().n;
    const lastEdit = db.prepare(`SELECT key, updated_at FROM content
                                 WHERE updated_by IS NOT NULL
                                 ORDER BY updated_at DESC LIMIT 1`).get();
    res.render('dashboard', {
      title: 'Dashboard',
      lastBuild,
      contentCount,
      userCount,
      lastEdit,
    });
  });

  // ---------- Content ----------
  app.get('/admin/content', (req, res) => {
    const rows = db.prepare(`SELECT * FROM content
                             ORDER BY page, section, sort_order, key`).all();
    const grouped = {};
    for (const r of rows) {
      const p = r.page || 'other';
      const s = r.section || '';
      grouped[p] = grouped[p] || {};
      grouped[p][s] = grouped[p][s] || [];
      grouped[p][s].push(r);
    }
    res.render('content-list', { title: 'Edit content', grouped });
  });

  app.get('/admin/content/:key', (req, res) => {
    const row = db.prepare('SELECT * FROM content WHERE key = ?').get(req.params.key);
    if (!row) return res.status(404).send('Not found');
    const revs = db.prepare(`SELECT cr.*, u.email AS editor
                             FROM content_revisions cr
                             LEFT JOIN users u ON cr.updated_by = u.id
                             WHERE cr.key = ? ORDER BY cr.updated_at DESC LIMIT 20`)
      .all(req.params.key);
    res.render('content-edit', { title: row.label || row.key, row, revs });
  });

  app.post('/admin/content/:key', (req, res) => {
    const row = db.prepare('SELECT * FROM content WHERE key = ?').get(req.params.key);
    if (!row) return res.status(404).send('Not found');
    const value = (req.body.value == null ? '' : String(req.body.value));
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO content_revisions (key, value, updated_at, updated_by)
                  VALUES (?, ?, ?, ?)`)
        .run(row.key, row.value, row.updated_at, row.updated_by);
      db.prepare(`UPDATE content SET value = ?, updated_at = datetime('now'), updated_by = ?
                  WHERE key = ?`).run(value, req.user.id, row.key);
    });
    tx();
    req.flash('info', `Saved ${row.key}.`);
    res.redirect('/admin/content/' + encodeURIComponent(row.key));
  });

  // ---------- Rebuild ----------
  app.post('/admin/build', (req, res) => {
    let status = 'ok', log = '';
    let buildId;
    try {
      const result = db.prepare(`INSERT INTO builds (status, triggered_by) VALUES ('running', ?)`)
        .run(req.user.id);
      buildId = result.lastInsertRowid;
      const meta = build({ verbose: false });
      log = `Built ${meta.pages.length} pages in ${meta.durationMs}ms.`;
    } catch (e) {
      status = 'error';
      log = (e.stack || e.message || String(e)).slice(0, 4000);
    }
    if (buildId) {
      db.prepare(`UPDATE builds SET status = ?, log = ?, finished_at = datetime('now') WHERE id = ?`)
        .run(status, log, buildId);
    }
    req.flash(status === 'ok' ? 'info' : 'error', log);
    res.redirect('/admin');
  });

  // ---------- Users ----------
  app.get('/admin/users', requireSuperuser, (req, res) => {
    const users = db.prepare(`SELECT id, email, role, is_active, created_at, last_login_at
                              FROM users ORDER BY email`).all();
    res.render('users', { title: 'Users', users });
  });

  app.get('/admin/users/new', requireSuperuser, (req, res) => {
    res.render('user-new', { title: 'New user', error: null, email: '', role: 'admin' });
  });

  app.post('/admin/users', requireSuperuser, async (req, res) => {
    try {
      await auth.createUser({
        email: req.body.email,
        password: req.body.password,
        role: req.body.role === 'superuser' ? 'superuser' : 'admin',
      });
      req.flash('info', `Created ${req.body.email}.`);
      res.redirect('/admin/users');
    } catch (e) {
      res.status(400).render('user-new', {
        title: 'New user',
        error: e.message,
        email: req.body.email || '',
        role: req.body.role || 'admin',
      });
    }
  });

  app.get('/admin/users/:id', requireSuperuser, (req, res) => {
    const u = auth.findUserById(Number(req.params.id));
    if (!u) return res.status(404).send('Not found');
    res.render('user-edit', { title: u.email, target: u, error: null });
  });

  app.post('/admin/users/:id', requireSuperuser, async (req, res) => {
    const target = auth.findUserById(Number(req.params.id));
    if (!target) return res.status(404).send('Not found');

    const action = req.body.action;
    try {
      if (action === 'update') {
        const next = {
          email: (req.body.email || target.email).toLowerCase().trim(),
          role: req.body.role === 'superuser' ? 'superuser' : 'admin',
          is_active: req.body.is_active === 'on' ? 1 : 0,
        };
        if (target.role === 'superuser' && target.is_active &&
            !(next.role === 'superuser' && next.is_active === 1) &&
            auth.countOtherActiveSuperusers(target.id) === 0) {
          throw new Error('Refusing to demote/deactivate the last superuser.');
        }
        db.prepare(`UPDATE users SET email = ?, role = ?, is_active = ? WHERE id = ?`)
          .run(next.email, next.role, next.is_active, target.id);
        req.flash('info', `Updated ${next.email}.`);
      } else if (action === 'password') {
        const err = auth.validatePassword(req.body.password);
        if (err) throw new Error(err);
        const hash = await auth.hashPassword(req.body.password);
        db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?')
          .run(hash, target.id);
        req.flash('info', `Password reset for ${target.email}.`);
      } else if (action === 'delete') {
        if (target.role === 'superuser' && target.is_active &&
            auth.countOtherActiveSuperusers(target.id) === 0) {
          throw new Error('Refusing to delete the last superuser.');
        }
        db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
        req.flash('info', `Deleted ${target.email}.`);
        return res.redirect('/admin/users');
      }
      res.redirect('/admin/users/' + target.id);
    } catch (e) {
      res.status(400).render('user-edit', { title: target.email, target, error: e.message });
    }
  });

  // ---------- Account (self) ----------
  app.get('/admin/account', (req, res) => {
    res.render('account', { title: 'Account', error: null });
  });

  app.post('/admin/account', async (req, res) => {
    try {
      const err = auth.validatePassword(req.body.password);
      if (err) throw new Error(err);
      const hash = await auth.hashPassword(req.body.password);
      db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?')
        .run(hash, req.user.id);
      req.flash('info', 'Password updated.');
      res.redirect('/admin/account');
    } catch (e) {
      res.status(400).render('account', { title: 'Account', error: e.message });
    }
  });

  // ---------- Media library ----------
  const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);
  const uploadMw = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED.has(file.mimetype)) return cb(new Error('Unsupported image type.'));
      cb(null, true);
    },
  });

  app.get('/admin/media', (req, res) => {
    const rows = db.prepare(`SELECT * FROM media ORDER BY uploaded_at DESC`).all();
    res.render('media', { title: 'Media library', items: rows });
  });

  app.post('/admin/media', uploadMw.single('file'), async (req, res) => {
    if (!req.file) { req.flash('error', 'No file uploaded.'); return res.redirect('/admin/media'); }
    try {
      fs.mkdirSync(config.uploadDir, { recursive: true });
      const ext = ({
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
        'image/gif': '.gif', 'image/svg+xml': '.svg'
      })[req.file.mimetype] || '.bin';
      const base = path.basename(req.file.originalname, path.extname(req.file.originalname))
        .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 60) || 'image';
      const hash = crypto.randomBytes(4).toString('hex');
      const filename = `${base}-${hash}${ext}`;
      let width = null, height = null;
      try {
        if (req.file.mimetype !== 'image/svg+xml') {
          const m = await sharp(req.file.buffer).metadata();
          width = m.width || null; height = m.height || null;
        }
      } catch (_e) {}
      fs.writeFileSync(path.join(config.uploadDir, filename), req.file.buffer);
      db.prepare(`INSERT INTO media (filename, original, mime, width, height, byte_size, uploaded_by)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(filename, req.file.originalname, req.file.mimetype, width, height,
             req.file.size, req.user.id);
      req.flash('info', `Uploaded ${filename}.`);
    } catch (e) {
      req.flash('error', e.message);
    }
    res.redirect('/admin/media');
  });

  app.post('/admin/media/:id/delete', (req, res) => {
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (row) {
      try { fs.unlinkSync(path.join(config.uploadDir, row.filename)); } catch (_e) {}
      db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
      req.flash('info', `Deleted ${row.filename}.`);
    }
    res.redirect('/admin/media');
  });
};
