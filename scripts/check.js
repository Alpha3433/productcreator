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

const { config, validateForLiveRequest } = require('../src/config');
const { shopifyGraphQL } = require('../src/shopify/client');
const Q = require('../src/shopify/queries');

// Show only the non-secret prefix + length of the token, never the value.
function tokenPreview(t) {
  if (!t) return '(unset)';
  const prefix = t.includes('_') ? t.slice(0, t.indexOf('_') + 1) : t.slice(0, 4);
  return `${prefix}… (${t.length} chars)`;
}

(async () => {
  console.log('Product Launcher — setup check\n');
  console.log(`  Store:  ${config.store || '(unset)'}`);
  console.log(`  API:    ${config.apiVersion}`);
  console.log(`  Master: ${config.masterProductId || '(unset)'}`);
  console.log(`  Token:  ${tokenPreview(config.adminToken)}\n`);

  const problems = validateForLiveRequest();
  if (problems.length) {
    console.log('✗ Config problems:');
    problems.forEach((p) => console.log(`   - ${p}`));
    console.log('\n  Fix .env, then re-run `npm run check`.');
    process.exit(1);
  }

  if (!config.adminToken.startsWith('shpat_')) {
    console.log('! Your token does not start with "shpat_". A custom-app Admin API access');
    console.log('  token starts with shpat_. The client secret (shpss_), Headless/Storefront');
    console.log('  tokens, and other prefixes will NOT work for the Admin API.\n');
  }

  // 1) Authenticate.
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
      console.log('  → Use the shpat_ Admin API access token (Install app → reveal it) and');
      console.log('    confirm the app scopes. See the README.');
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
