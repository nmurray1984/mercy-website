'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { build } = require('../../build/build');

const router = express.Router();
router.use(requireAuth);

// Only one build at a time. Subsequent calls return 409 while one runs.
let inflight = null;

router.post('/', (req, res) => {
  if (inflight) {
    return res.status(409).json({ error: 'A build is already running.', buildId: inflight.id });
  }
  const result = db.prepare(`INSERT INTO builds (status, triggered_by) VALUES ('running', ?)`)
    .run(req.user.id);
  const id = result.lastInsertRowid;
  inflight = { id, startedAt: Date.now() };

  setImmediate(async () => {
    let status = 'ok';
    let log = '';
    try {
      const meta = build({ verbose: false });
      log = `Built ${meta.pages.length} pages in ${meta.durationMs}ms. Content rows: ${meta.contentRows}.`;
    } catch (e) {
      status = 'error';
      log = (e.stack || e.message || String(e)).slice(0, 4000);
    }
    db.prepare(`UPDATE builds SET status = ?, log = ?, finished_at = datetime('now') WHERE id = ?`)
      .run(status, log, id);
    inflight = null;
  });

  res.status(202).json({ buildId: Number(id) });
});

router.get('/latest', (req, res) => {
  const row = db.prepare(`SELECT * FROM builds ORDER BY id DESC LIMIT 1`).get();
  res.json(row || null);
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM builds WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

module.exports = router;
