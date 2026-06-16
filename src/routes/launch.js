'use strict';

const express = require('express');
const multer = require('multer');
const { runLaunch } = require('../shopify/launch');
const { validateForLiveRequest } = require('../config');

const router = express.Router();

// Uploads are held in memory and streamed straight to Shopify's staged storage,
// so nothing touches disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 }, // 20 MB / file, 10 files
});

// POST /api/launch — the single endpoint behind the "Launch product" button.
router.post('/launch', upload.array('images', 10), async (req, res) => {
  try {
    const body = req.body || {};
    const mode = (body.mode || 'DUPLICATE').toUpperCase();
    const status = (body.status || 'DRAFT').toUpperCase();
    const dryRun = String(body.dryRun) === 'true';
    const useAsync = String(body.async) === 'true';

    const images = (req.files || []).map((f) => ({
      filename: f.originalname,
      mimeType: f.mimetype,
      buffer: f.buffer,
    }));

    // ---- Server-side validation (mirrors the inline UI checks) ------------
    const errors = [];
    if (mode === 'DUPLICATE' && !body.title) errors.push('Title is required.');
    if (mode === 'EXISTING' && !body.existingProductId) {
      errors.push('Existing product ID is required for EXISTING mode.');
    }
    if (mode !== 'EXISTING' && images.length === 0) {
      errors.push('At least one image is required.');
    }
    if (status === 'SCHEDULE' && !body.publishDate) {
      errors.push('A publish date is required to schedule.');
    }
    if (errors.length) return res.status(400).json({ ok: false, errors });

    // Live requests need real credentials; dry-run does not.
    if (!dryRun) {
      const problems = validateForLiveRequest();
      if (problems.length) return res.status(400).json({ ok: false, errors: problems });
    }

    const result = await runLaunch({
      mode,
      title: body.title,
      existingProductId: body.existingProductId,
      priceOverride: body.priceOverride,
      status,
      // Normalise to an ISO DateTime (the browser sends one already).
      publishDate: body.publishDate ? new Date(body.publishDate).toISOString() : null,
      images,
      dryRun,
      async: useAsync,
    });

    return res.json(result);
  } catch (err) {
    // Surface a readable, token-free error to the UI.
    const payload = { ok: false, error: err.message };
    if (err.details) payload.details = err.details;
    return res.status(500).json(payload);
  }
});

module.exports = router;
