'use strict';

const path = require('path');
const express = require('express');
const { config, publicConfig } = require('./src/config');
const launchRouter = require('./src/routes/launch');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the single-page UI from /public.
app.use(express.static(path.join(__dirname, 'public')));

// Non-secret config for the UI (store, master id, bundle reminder). Never the token.
app.get('/api/config', (req, res) => res.json(publicConfig()));

// The launch endpoint.
app.use('/api', launchRouter);

app.listen(config.port, () => {
  // Never log the token — just confirm what the server is pointed at.
  console.log(`\nProduct Launcher → http://localhost:${config.port}`);
  console.log(`  Store:       ${config.store || '(not set — edit .env)'}`);
  console.log(`  API version: ${config.apiVersion}`);
  console.log(`  Master:      ${config.masterProductId || '(not set — edit .env)'}`);
  if (!config.adminToken) {
    console.log('  WARNING: SHOPIFY_ADMIN_TOKEN is not set — live launches will fail (dry-run still works).');
  }
  console.log('');
});
