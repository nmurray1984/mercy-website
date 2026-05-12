'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../db');
const auth = require('../auth');
const { requireAuth, requireSuperuser } = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

// Self password change is allowed for any authenticated user.
const passwordSchema = z.object({
  password: z.string(),
});

router.post('/:id/password', async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'bad id' });

  // Self or superuser
  if (targetId !== req.user.id && req.user.role !== 'superuser') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const err = auth.validatePassword(parsed.data.password);
  if (err) return res.status(400).json({ error: err });

  const target = auth.findUserById(targetId);
  if (!target) return res.status(404).json({ error: 'not found' });

  const hash = await auth.hashPassword(parsed.data.password);
  db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?')
    .run(hash, targetId);
  res.json({ ok: true });
});

// All of the below is superuser only.
router.use(requireSuperuser);

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT id, email, role, is_active, created_at, last_login_at,
                                  failed_attempts, locked_until FROM users ORDER BY email`).all();
  res.json(rows);
});

const createSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'superuser']),
  password: z.string(),
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
  try {
    const user = await auth.createUser(parsed.data);
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(['admin', 'superuser']).optional(),
  is_active: z.boolean().optional(),
});

router.put('/:id', (req, res) => {
  const targetId = Number(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
  const target = auth.findUserById(targetId);
  if (!target) return res.status(404).json({ error: 'not found' });

  const next = {
    email: parsed.data.email ?? target.email,
    role: parsed.data.role ?? target.role,
    is_active: parsed.data.is_active === undefined ? target.is_active : (parsed.data.is_active ? 1 : 0),
  };

  // Last-active-superuser guard
  const willBeSuperActive = next.role === 'superuser' && next.is_active === 1;
  if (target.role === 'superuser' && target.is_active && !willBeSuperActive) {
    if (auth.countOtherActiveSuperusers(target.id) === 0) {
      return res.status(409).json({
        error: 'Refusing to demote or deactivate the last active superuser.'
      });
    }
  }

  db.prepare(`UPDATE users SET email = ?, role = ?, is_active = ? WHERE id = ?`)
    .run(next.email.toLowerCase().trim(), next.role, next.is_active, target.id);
  const updated = auth.findUserById(target.id);
  res.json({ id: updated.id, email: updated.email, role: updated.role, is_active: !!updated.is_active });
});

router.delete('/:id', (req, res) => {
  const targetId = Number(req.params.id);
  const target = auth.findUserById(targetId);
  if (!target) return res.status(404).json({ error: 'not found' });

  if (target.role === 'superuser' && target.is_active) {
    if (auth.countOtherActiveSuperusers(target.id) === 0) {
      return res.status(409).json({ error: 'Refusing to delete the last active superuser.' });
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.status(204).end();
});

module.exports = router;
