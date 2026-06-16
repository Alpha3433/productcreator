'use strict';

const { config } = require('./config');

// -----------------------------------------------------------------------------
// BUNDLE — extension point.
//
// IMPORTANT: in the "Old Glory" theme this store uses, the "1 Flag / 2 Flags"
// (Single / Patriot Pair / Family Set) bundle is NOT a third-party app. It is
// built natively into the theme as section blocks of type "bundle" in
// sections/main-product.liquid, configured on the product *template*
// (e.g. product.flag.json / product.landing.json).
//
// Because those blocks live on the TEMPLATE (shared by every product using that
// templateSuffix), they copy across automatically as soon as the new product's
// templateSuffix matches the master — which the launch flow already guarantees
// in step 2. So there is usually NOTHING to do here, and the success card just
// reminds you to check the discount.
//
// The only piece that does not live on the product is the *savings*: the theme's
// own help text says to pair the bundle cards with a Shopify automatic volume
// discount (Admin → Discounts → Amount off products → quantity minimum). If that
// discount targets ALL products (or a collection the new product joins), nothing
// is needed. If it targets SPECIFIC products, the new product must be added to it.
//
// To automate that last step:
//   1. Set BUNDLE_AUTOMATION_ENABLED=true in .env
//   2. Add the discount id (AUTOMATIC_DISCOUNT_ID) and the write_discounts scope.
//   3. Implement applyBundle() below to add newProductId to the discount's items.
// -----------------------------------------------------------------------------
async function applyBundle(newProductId) {
  // TODO: Implement only if your automatic volume discount is product-scoped.
  //
  // Example (pseudo-code) using discountAutomaticBasicUpdate to add the product
  // to the discount's item targeting — requires the write_discounts scope:
  //
  //   const { shopifyGraphQL } = require('./shopify/client');
  //   await shopifyGraphQL(`
  //     mutation AddToDiscount($id: ID!, $product: ID!) {
  //       discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: {
  //         customerGets: { items: { products: { productsToAdd: [$product] } } }
  //       }) { userErrors { field message } }
  //     }`,
  //     { id: process.env.AUTOMATIC_DISCOUNT_ID, product: newProductId });
  //
  // Keep AUTOMATIC_DISCOUNT_ID (and any tokens) in .env — never hardcode them.
  throw new Error(
    'applyBundle() is not implemented. The theme bundle cards copy via the ' +
      'template automatically; only wire this up if your automatic discount is ' +
      `product-scoped and must include ${newProductId}.` +
      (config.bundleAppName ? ` (${config.bundleAppName})` : '')
  );
}

module.exports = { applyBundle };
