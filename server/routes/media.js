'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

// Uploaded images live under site/assets/img/uploads/. The build copies them
// to public/assets/img/uploads/ on the next rebuild.
fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new Error('Unsupported image type.'));
    cb(null, true);
  },
});

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT id, filename, original, mime, width, height, byte_size, uploaded_at
                           FROM media ORDER BY uploaded_at DESC`).all();
  res.json(rows);
});

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const ext = extFor(req.file.mimetype);
  const base = path.basename(req.file.originalname, path.extname(req.file.originalname))
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 60) || 'image';
  const hash = crypto.randomBytes(4).toString('hex');
  const filename = `${base}-${hash}${ext}`;
  const targetPath = path.join(config.uploadDir, filename);

  let width = null, height = null;
  try {
    if (req.file.mimetype !== 'image/svg+xml') {
      const meta = await sharp(req.file.buffer).metadata();
      width = meta.width || null;
      height = meta.height || null;
    }
  } catch (_e) {
    // image inspection is best-effort
  }

  fs.writeFileSync(targetPath, req.file.buffer);

  const result = db.prepare(`INSERT INTO media (filename, original, mime, width, height, byte_size, uploaded_by)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(filename, req.file.originalname, req.file.mimetype, width, height,
         req.file.size, req.user.id);

  res.status(201).json({
    id: Number(result.lastInsertRowid),
    filename,
    url: `/assets/img/uploads/${filename}`,
    width,
    height,
  });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const filepath = path.join(config.uploadDir, row.filename);
  try { fs.unlinkSync(filepath); } catch (_e) {}
  db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
  res.status(204).end();
});

function extFor(mime) {
  switch (mime) {
    case 'image/jpeg': return '.jpg';
    case 'image/png':  return '.png';
    case 'image/webp': return '.webp';
    case 'image/gif':  return '.gif';
    case 'image/svg+xml': return '.svg';
    default: return '.bin';
  }
}

module.exports = router;
