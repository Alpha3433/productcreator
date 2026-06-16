'use strict';

// All GraphQL operations live here so they are easy to read, comment, and
// re-verify against https://shopify.dev/docs/api/admin-graphql/2025-10
//
// Verified against the 2025-10 schema (June 2026):
//  - productDuplicate(productId, newTitle, includeImages, newStatus, synchronous)
//      returns newProduct (sync) or productDuplicateOperation (async)
//  - productUpdate(product: ProductUpdateInput!, media: [CreateMediaInput!])
//      ProductInput was split into ProductCreateInput/ProductUpdateInput in 2024-10;
//      productCreateMedia is deprecated in favour of attaching media via productUpdate.
//  - productVariantsBulkUpdate(productId, variants: [ProductVariantsBulkInput!]!)
//  - stagedUploadsCreate(input: [StagedUploadInput!]!)
//  - publishablePublish(id: ID!, input: [PublicationInput!]!)  (PublicationInput has publishDate)

// Clone the master product. Only native Shopify data is copied (theme/template
// suffix, variants, pricing, options). includeImages:false so we attach the new
// POD art ourselves. newStatus:DRAFT keeps it private until we publish.
const PRODUCT_DUPLICATE = `
mutation ProductDuplicate($productId: ID!, $newTitle: String!, $includeImages: Boolean, $newStatus: ProductStatus, $synchronous: Boolean) {
  productDuplicate(productId: $productId, newTitle: $newTitle, includeImages: $includeImages, newStatus: $newStatus, synchronous: $synchronous) {
    newProduct { id title handle status templateSuffix }
    productDuplicateOperation { id status }
    userErrors { field message }
  }
}`;

// Read a product's core fields + variants (for template comparison and pricing).
const GET_PRODUCT = `
query GetProduct($id: ID!) {
  product(id: $id) {
    id
    title
    handle
    status
    templateSuffix
    variants(first: 100) {
      edges { node { id title price } }
    }
  }
}`;

// Update scalar product fields (title / status / templateSuffix).
const PRODUCT_UPDATE = `
mutation ProductUpdate($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id title handle status templateSuffix }
    userErrors { field message }
  }
}`;

// Attach already-uploaded media to a product (current replacement for the
// deprecated productCreateMedia).
const PRODUCT_UPDATE_MEDIA = `
mutation ProductUpdateMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
  productUpdate(product: $product, media: $media) {
    product {
      id
      media(first: 20) {
        edges { node { id mediaContentType status preview { image { url } } } }
      }
    }
    userErrors { field message }
  }
}`;

// Ask Shopify for staged upload targets (one per file) before uploading bytes.
const STAGED_UPLOADS_CREATE = `
mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters { name value }
    }
    userErrors { field message }
  }
}`;

// Bulk-update variant prices (price override).
const VARIANTS_BULK_UPDATE = `
mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id title price }
    userErrors { field message }
  }
}`;

// List sales-channel publications so we can find the Online Store one.
const PUBLICATIONS = `
query Publications {
  publications(first: 50) {
    edges { node { id name } }
  }
}`;

// Publish (or schedule) a product to a publication. Omit publishDate to publish
// immediately; pass an ISO DateTime to schedule.
const PUBLISHABLE_PUBLISH = `
mutation PublishablePublish($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    publishable {
      ... on Product { id handle status }
    }
    userErrors { field message }
  }
}`;

// Poll an async duplicate operation node until it is COMPLETE.
const PRODUCT_OPERATION = `
query ProductOperation($id: ID!) {
  node(id: $id) {
    ... on ProductDuplicateOperation {
      id
      status
      product { id title handle status templateSuffix }
    }
  }
}`;

module.exports = {
  PRODUCT_DUPLICATE,
  GET_PRODUCT,
  PRODUCT_UPDATE,
  PRODUCT_UPDATE_MEDIA,
  STAGED_UPLOADS_CREATE,
  VARIANTS_BULK_UPDATE,
  PUBLICATIONS,
  PUBLISHABLE_PUBLISH,
  PRODUCT_OPERATION,
};
