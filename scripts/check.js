'use strict';

// ---------------------------------------------------------------------------
// Read-only setup self-test.  Run it on YOUR machine:
//
//     npm run check
//
// It confirms your Admin API token authenticates and prints the master product
// (title / status / template / variants). It makes NO changes. Use it to settle
// "does my token work?" without launching anything.
// ---------------------------------------------------------------------------

const { config, validateForLiveRequest, authMode } = require('../src/config');
const { shopifyGraphQL } = require('../src/shopify/client');
const { getAccessToken } = require('../src/shopify/auth');
const Q = require('../src/shopify/queries');

(async () => {
  const mode = authMode();
  console.log('Product Launcher — setup check\n');
  console.log(`  Store:  ${config.store || '(unset)'}`);
  console.log(`  API:    ${config.apiVersion}`);
  console.log(`  Master: ${config.masterProductId || '(unset)'}`);
  console.log(
    `  Auth:   ${
      mode === 'client_credentials'
        ? 'client credentials (Dev Dashboard app)'
        : mode === 'static_token'
        ? 'static admin token (legacy custom app)'
        : 'NONE'
    }\n`
  );

  const problems = validateForLiveRequest();
  if (problems.length) {
    console.log('✗ Config problems:');
    problems.forEach((p) => console.log(`   - ${p}`));
    console.log('\n  Fix .env, then re-run `npm run check`.');
    process.exit(1);
  }

  // 0) For Dev Dashboard apps, exchange client credentials for a token first so
  //    a credential problem is reported clearly (before any GraphQL call).
  if (mode === 'client_credentials') {
    try {
      await getAccessToken({ forceRefresh: true });
      console.log('✓ Obtained an access token via client credentials grant (auto-refreshes ~24h).');
    } catch (e) {
      console.log(`✗ Could not obtain an access token: ${e.message}`);
      const body = e.details && e.details.body;
      if (body && /allowlist|egress/i.test(body)) {
        console.log('  → NETWORK/firewall block, not Shopify. Run this on your own machine.');
      } else {
        console.log('  → Check SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET (Dev Dashboard → your app → Settings).');
      }
      process.exit(1);
    }
  }

  // 1) Authenticate against the Admin API.
  try {
    const data = await shopifyGraphQL('{ shop { name myshopifyDomain } }', {}, { maxRetries: 2 });
    console.log(`✓ Authenticated — shop: ${data.shop.name} (${data.shop.myshopifyDomain})`);
  } catch (e) {
    console.log(`✗ Could not authenticate: ${e.message}`);
    const body = e.details && e.details.body;
    if (body) {
      console.log(`  Response: ${body}`);
      if (/allowlist|egress/i.test(body)) {
        console.log('  → This is a NETWORK/firewall block, not Shopify. Run this on your own');
        console.log('    machine, or allow *.myshopify.com in your network egress settings.');
      }
    } else {
      console.log('  → Check your credentials and the app scopes. See the README.');
    }
    process.exit(1);
  }

  // 2) Read the master product.
  try {
    const data = await shopifyGraphQL(Q.GET_PRODUCT, { id: config.masterProductId }, { maxRetries: 2 });
    if (!data.product) {
      console.log(`\n✗ Master product not found: ${config.masterProductId}`);
      console.log('  Check MASTER_PRODUCT_ID = gid://shopify/Product/<numeric id from the admin URL>.');
      process.exit(1);
    }
    const p = data.product;
    const vs = p.variants.edges.map((e) => `${e.node.title} = ${e.node.price}`);
    console.log('\n✓ Master product:');
    console.log(`   Title:    ${p.title}`);
    console.log(`   Status:   ${p.status}`);
    console.log(`   Template: ${p.templateSuffix || '(default product template)'}`);
    console.log(`   Handle:   ${p.handle}`);
    console.log(`   Variants (${vs.length}): ${vs.join(' | ')}`);
    console.log('\nAll good — start the UI with `npm start` and launch away.');
  } catch (e) {
    console.log(`\n✗ Could not read the master product: ${e.message}`);
    if (e.details && e.details.body) console.log(`  Response: ${e.details.body}`);
    process.exit(1);
  }
})();
