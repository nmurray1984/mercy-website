'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

const ALLOWED_KINDS = ['text', 'markdown', 'html', 'image'];

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT key, value, kind, page, section, label, description, updated_at, updated_by
    FROM content
    ORDER BY page, section, sort_order, key
  `).all();
  res.json(rows);
});

router.get('/:key', (req, res) => {
  const row = db.prepare('SELECT * FROM content WHERE key = ?').get(req.params.key);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

const valueSchema = z.object({
  value: z.string(),
  kind: z.enum(ALLOWED_KINDS).optional(),
});

router.put('/:key', (req, res) => {
  const parsed = valueSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
  const existing = db.prepare('SELECT * FROM content WHERE key = ?').get(req.params.key);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const newValue = parsed.data.value;
  const newKind = parsed.data.kind || existing.kind;

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO content_revisions (key, value, updated_at, updated_by)
                VALUES (?, ?, ?, ?)`)
      .run(existing.key, existing.value, existing.updated_at, existing.updated_by);

    db.prepare(`UPDATE content
                SET value = ?, kind = ?, updated_at = datetime('now'), updated_by = ?
                WHERE key = ?`)
      .run(newValue, newKind, req.user.id, existing.key);
  });
  tx();

  const updated = db.prepare('SELECT * FROM content WHERE key = ?').get(req.params.key);
  res.json(updated);
});

router.get('/:key/revisions', (req, res) => {
  const rows = db.prepare(`
    SELECT id, key, value, updated_at, updated_by
    FROM content_revisions WHERE key = ?
    ORDER BY updated_at DESC LIMIT 50
  `).all(req.params.key);
  res.json(rows);
});

router.post('/:key/revert/:revId', (req, res) => {
  const rev = db.prepare(`SELECT * FROM content_revisions WHERE id = ? AND key = ?`)
    .get(req.params.revId, req.params.key);
  if (!rev) return res.status(404).json({ error: 'revision not found' });

  const existing = db.prepare('SELECT * FROM content WHERE key = ?').get(req.params.key);
  if (!existing) return res.status(404).json({ error: 'key not found' });

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO content_revisions (key, value, updated_at, updated_by)
                VALUES (?, ?, ?, ?)`)
      .run(existing.key, existing.value, existing.updated_at, existing.updated_by);
    db.prepare(`UPDATE content SET value = ?, updated_at = datetime('now'), updated_by = ?
                WHERE key = ?`).run(rev.value, req.user.id, existing.key);
  });
  tx();

  const updated = db.prepare('SELECT * FROM content WHERE key = ?').get(req.params.key);
  res.json(updated);
});

module.exports = router;
