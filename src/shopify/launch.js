'use strict';

const Q = require('./queries');
const {
  shopifyGraphQL,
  uploadToStagedTarget,
  collectUserErrors,
  ShopifyError,
} = require('./client');
const { config } = require('../config');
const { applyBundle } = require('../bundle');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// gid://shopify/Product/123 -> "123"
function numericId(gid) {
  const m = String(gid).match(/\/(\d+)(?:\?|$)/);
  return m ? m[1] : null;
}

function adminProductUrl(gid) {
  const id = numericId(gid);
  return id ? `https://${config.store}/admin/products/${id}` : null;
}

function storefrontUrl(handle) {
  // Uses the *.myshopify.com domain; a custom storefront domain may differ.
  return handle ? `https://${config.store}/products/${handle}` : null;
}

// Throws a clean error if a mutation payload contains userErrors.
function assertNoUserErrors(payload, label) {
  const errs = collectUserErrors(payload);
  if (errs) throw new ShopifyError(`${label} failed.`, { userErrors: errs });
}

/**
 * Main orchestration for the "Launch product" button.
 *
 * input = {
 *   mode: 'DUPLICATE' | 'EXISTING',
 *   title, existingProductId, priceOverride, status, publishDate (ISO),
 *   images: [{ filename, mimeType, buffer }],
 *   dryRun: boolean,
 *   async: boolean        // duplicate with synchronous:false + poll
 * }
 */
async function runLaunch(input) {
  // ---- DRY RUN: describe the planned calls, run no mutations -------------
  if (input.dryRun) return dryRunPlan(input);

  const warnings = [];
  let productId;
  let product = {}; // { id, title, handle, status, templateSuffix }

  // 1) Get the product to operate on (duplicate the master, or use existing).
  if (input.mode === 'EXISTING') {
    productId = input.existingProductId;
    const data = await shopifyGraphQL(Q.GET_PRODUCT, { id: productId });
    if (!data.product) throw new ShopifyError('Existing product not found.', { id: productId });
    product = data.product;

    // Optional rename for EXISTING mode.
    if (input.title && input.title !== product.title) {
      const upd = await shopifyGraphQL(Q.PRODUCT_UPDATE, {
        product: { id: productId, title: input.title },
      });
      assertNoUserErrors(upd.productUpdate, 'Rename product');
    }
  } else {
    // productDuplicate clones ONLY native Shopify data. includeImages:false so we
    // attach the new design ourselves; newStatus:DRAFT keeps it private for now.
    const dup = await shopifyGraphQL(Q.PRODUCT_DUPLICATE, {
      productId: config.masterProductId,
      newTitle: input.title,
      includeImages: false,
      newStatus: 'DRAFT',
      synchronous: !input.async,
    });
    assertNoUserErrors(dup.productDuplicate, 'Duplicate product');

    if (input.async) {
      // Large masters can exceed the synchronous timeout; poll the operation.
      const op = dup.productDuplicate.productDuplicateOperation;
      product = await pollDuplicateOperation(op.id);
    } else {
      product = dup.productDuplicate.newProduct;
    }
    productId = product.id;
  }

  // 2) Ensure templateSuffix matches the master (this drives the custom page
  //    layout). It normally carries over on duplicate, but we verify and fix.
  const masterData = await shopifyGraphQL(Q.GET_PRODUCT, { id: config.masterProductId });
  const masterSuffix = masterData.product ? masterData.product.templateSuffix : null;
  if ((product.templateSuffix || null) !== (masterSuffix || null)) {
    const upd = await shopifyGraphQL(Q.PRODUCT_UPDATE, {
      product: { id: productId, templateSuffix: masterSuffix },
    });
    assertNoUserErrors(upd.productUpdate, 'Set templateSuffix');
    product.templateSuffix = masterSuffix;
    warnings.push(
      `templateSuffix did not match the master; set it to "${masterSuffix || '(default)'}".`
    );
  }

  // 3) Upload + attach the new design image(s).
  if (input.images && input.images.length) {
    await uploadAndAttachImages(productId, input.images);
  }

  // 4) Optional price override (applied to every variant).
  if (input.priceOverride != null && String(input.priceOverride).trim() !== '') {
    await applyPriceOverride(productId, String(input.priceOverride).trim());
  }

  // 5) Publish according to the chosen status.
  const publishResult = await publish(productId, input.status, input.publishDate);
  if (publishResult.warning) warnings.push(publishResult.warning);

  // 6) Bundle (extension point). In the "Old Glory" theme the bundle offer
  //    cards are NATIVE theme section blocks defined on the template, so they
  //    copy automatically once templateSuffix matches (done in step 2). The
  //    only thing that may not carry over is the Shopify automatic volume
  //    discount that makes the savings real — verify it covers this product.
  if (config.bundleAutomationEnabled) {
    try {
      await applyBundle(productId);
    } catch (e) {
      warnings.push(`Bundle automation failed: ${e.message}`);
    }
  } else {
    const suffix = product.templateSuffix || '(default)';
    warnings.push(
      `Bundle offer cards come from the "${suffix}" theme template and copy automatically. ` +
        `Confirm your Shopify automatic volume discount covers this product (Admin → Discounts).` +
        (config.bundleAppName ? ` Notes: ${config.bundleAppName}.` : '')
    );
  }

  // 7) Re-read final state so the returned links/status are accurate.
  const finalData = await shopifyGraphQL(Q.GET_PRODUCT, { id: productId });
  const fp = finalData.product || product;
  return {
    ok: true,
    productId,
    title: fp.title || input.title,
    status: fp.status,
    handle: fp.handle,
    adminUrl: adminProductUrl(productId),
    storefrontUrl: storefrontUrl(fp.handle),
    warnings,
  };
}

// --- helpers ---------------------------------------------------------------

async function uploadAndAttachImages(productId, images) {
  // a) Request one staged upload target per file.
  const stagedInput = images.map((img) => ({
    filename: img.filename,
    mimeType: img.mimeType,
    httpMethod: 'POST',
    resource: 'IMAGE',
  }));
  const staged = await shopifyGraphQL(Q.STAGED_UPLOADS_CREATE, { input: stagedInput });
  assertNoUserErrors(staged.stagedUploadsCreate, 'Stage uploads');
  const targets = staged.stagedUploadsCreate.stagedTargets;

  // b) Upload the raw bytes to each target's storage URL.
  const media = [];
  for (let i = 0; i < targets.length; i++) {
    await uploadToStagedTarget(targets[i], images[i]);
    // resourceUrl is the reference we hand back to Shopify when attaching media.
    media.push({
      originalSource: targets[i].resourceUrl,
      mediaContentType: 'IMAGE',
      alt: images[i].filename,
    });
  }

  // c) Attach the uploaded files as product media (replaces productCreateMedia).
  const upd = await shopifyGraphQL(Q.PRODUCT_UPDATE_MEDIA, {
    product: { id: productId },
    media,
  });
  assertNoUserErrors(upd.productUpdate, 'Attach media');
}

async function applyPriceOverride(productId, price) {
  // Read variant ids, then bulk-update them all to the override price.
  const data = await shopifyGraphQL(Q.GET_PRODUCT, { id: productId });
  const variants = ((data.product && data.product.variants.edges) || []).map((e) => e.node);
  if (!variants.length) return;
  const updates = variants.map((v) => ({ id: v.id, price }));
  const res = await shopifyGraphQL(Q.VARIANTS_BULK_UPDATE, { productId, variants: updates });
  assertNoUserErrors(res.productVariantsBulkUpdate, 'Update variant prices');
}

async function publish(productId, status, publishDate) {
  if (status === 'DRAFT') {
    // Nothing to do — the product is already DRAFT.
    return {};
  }

  if (status === 'ACTIVE') {
    // Mark active...
    const upd = await shopifyGraphQL(Q.PRODUCT_UPDATE, {
      product: { id: productId, status: 'ACTIVE' },
    });
    assertNoUserErrors(upd.productUpdate, 'Activate product');

    // ...and publish to the Online Store channel so it is visible right now.
    // (Setting status ACTIVE alone does NOT publish to a sales channel.)
    const pubId = await onlineStorePublicationId();
    if (!pubId) return { warning: 'Could not find the Online Store publication; publish manually.' };
    const pub = await shopifyGraphQL(Q.PUBLISHABLE_PUBLISH, {
      id: productId,
      input: [{ publicationId: pubId }],
    });
    assertNoUserErrors(pub.publishablePublish, 'Publish to Online Store');
    return {};
  }

  if (status === 'SCHEDULE') {
    if (!publishDate) throw new ShopifyError('A publish date is required to schedule.', {});

    // The product must be ACTIVE so it can sell when the date arrives; the
    // publishDate on the publication gates storefront visibility until then.
    const upd = await shopifyGraphQL(Q.PRODUCT_UPDATE, {
      product: { id: productId, status: 'ACTIVE' },
    });
    assertNoUserErrors(upd.productUpdate, 'Activate product (scheduled)');

    const pubId = await onlineStorePublicationId();
    if (!pubId) throw new ShopifyError('Could not find the Online Store publication to schedule.', {});
    const pub = await shopifyGraphQL(Q.PUBLISHABLE_PUBLISH, {
      id: productId,
      input: [{ publicationId: pubId, publishDate }],
    });
    assertNoUserErrors(pub.publishablePublish, 'Schedule publish');
    return { warning: `Scheduled to go live at ${publishDate}.` };
  }

  throw new ShopifyError(`Unknown status "${status}".`, {});
}

async function onlineStorePublicationId() {
  const data = await shopifyGraphQL(Q.PUBLICATIONS, {});
  const edges = (data.publications && data.publications.edges) || [];
  const node = edges.map((e) => e.node).find((n) => n.name === 'Online Store');
  return node ? node.id : null;
}

async function pollDuplicateOperation(operationId) {
  // Poll the ProductDuplicateOperation node until COMPLETE (~60s max).
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    const data = await shopifyGraphQL(Q.PRODUCT_OPERATION, { id: operationId });
    const op = data.node;
    if (op && op.status === 'COMPLETE' && op.product) return op.product;
    await sleep(2000);
  }
  throw new ShopifyError('Async duplication did not complete in time.', { operationId });
}

// Builds a token-free description of what a real launch would do.
function dryRunPlan(input) {
  const steps = [];
  if (input.mode === 'EXISTING') {
    steps.push({ call: 'query product', args: { id: input.existingProductId } });
    if (input.title) {
      steps.push({ call: 'productUpdate (rename)', args: { title: input.title } });
    }
  } else {
    steps.push({
      call: 'productDuplicate',
      args: {
        productId: config.masterProductId,
        newTitle: input.title,
        includeImages: false,
        newStatus: 'DRAFT',
        synchronous: !input.async,
      },
    });
  }

  steps.push({ call: 'query master + productUpdate templateSuffix (if it differs)' });

  if (input.images && input.images.length) {
    steps.push({
      call: 'stagedUploadsCreate → upload bytes → productUpdate(media)',
      args: { files: input.images.map((f) => f.filename) },
    });
  }

  if (input.priceOverride != null && String(input.priceOverride).trim() !== '') {
    steps.push({
      call: 'productVariantsBulkUpdate',
      args: { price: String(input.priceOverride).trim(), appliesTo: 'all variants' },
    });
  }

  if (input.status === 'ACTIVE') {
    steps.push({ call: 'productUpdate status=ACTIVE + publishablePublish (Online Store, now)' });
  } else if (input.status === 'SCHEDULE') {
    steps.push({
      call: 'productUpdate status=ACTIVE + publishablePublish (Online Store)',
      args: { publishDate: input.publishDate },
    });
  } else {
    steps.push({ call: 'leave as DRAFT' });
  }

  steps.push({
    call: config.bundleAutomationEnabled
      ? 'applyBundle(newProductId)'
      : 'skip bundle automation (theme bundle cards copy via templateSuffix; discount reminder shown)',
  });

  return {
    ok: true,
    dryRun: true,
    plan: steps,
    warnings: config.bundleAutomationEnabled
      ? []
      : [
          'Bundle offer cards copy automatically with the theme template. ' +
            'Confirm your Shopify automatic volume discount covers the new product (Admin → Discounts).',
        ],
  };
}

module.exports = { runLaunch };
