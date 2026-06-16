'use strict';

const { config } = require('./config');

// -----------------------------------------------------------------------------
// BUNDLE AUTOMATION — extension point (the big one).
//
// productDuplicate only clones native Shopify data. If your product page uses a
// third-party bundle app (e.g. a "1 Flag / 2 Flags" quantity bundle), that
// configuration lives inside the APP, not on the Shopify product, so it is NOT
// copied when you duplicate.
//
// To automate it:
//   1. Set BUNDLE_AUTOMATION_ENABLED=true in .env
//   2. Implement applyBundle() below using your bundle app's API.
//
// While BUNDLE_AUTOMATION_ENABLED is false, the launch flow skips this function
// and the success card reminds you to set the bundle up manually.
// -----------------------------------------------------------------------------
async function applyBundle(newProductId) {
  // TODO: Wire up your bundle app here.
  //
  // Example shape (pseudo-code) once you know the app's API:
  //   await fetch('https://<bundle-app-host>/api/bundles', {
  //     method: 'POST',
  //     headers: { Authorization: `Bearer ${process.env.BUNDLE_APP_TOKEN}` },
  //     body: JSON.stringify({ productId: newProductId, tiers: [1, 2] }),
  //   });
  //
  // Keep any bundle-app token in .env (e.g. BUNDLE_APP_TOKEN) — never hardcode it.
  throw new Error(
    `applyBundle() is not implemented yet. Wire up "${config.bundleAppName}" in src/bundle.js ` +
      `(product ${newProductId}).`
  );
}

module.exports = { applyBundle };
