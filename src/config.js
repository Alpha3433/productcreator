'use strict';

// Loads and validates configuration from environment variables.
// SECURITY: secrets are read from process.env ONLY. The admin token is never
// logged, never returned to the browser, and never put in error messages.

require('dotenv').config();

const DEFAULT_API_VERSION = '2025-10';

const config = {
  store: (process.env.SHOPIFY_STORE || '').trim(),
  adminToken: process.env.SHOPIFY_ADMIN_TOKEN || '',
  apiVersion: (process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim(),
  masterProductId: (process.env.MASTER_PRODUCT_ID || '').trim(),
  bundleAutomationEnabled:
    String(process.env.BUNDLE_AUTOMATION_ENABLED || 'false').toLowerCase() === 'true',
  bundleAppName: (process.env.BUNDLE_APP_NAME || 'your bundle app').trim(),
  port: Number(process.env.PORT || 3000),
};

// The Admin GraphQL endpoint for the configured store + pinned version.
config.graphqlEndpoint = () =>
  `https://${config.store}/admin/api/${config.apiVersion}/graphql.json`;

// Returns human-readable problems with the current config. Used to fail fast
// on real (non dry-run) requests; dry-run does not require credentials.
function validateForLiveRequest() {
  const problems = [];
  if (!config.store) {
    problems.push('SHOPIFY_STORE is not set in .env');
  } else if (!config.store.endsWith('.myshopify.com')) {
    problems.push('SHOPIFY_STORE should be your *.myshopify.com domain');
  }
  if (!config.adminToken) problems.push('SHOPIFY_ADMIN_TOKEN is not set in .env');
  if (!config.masterProductId.startsWith('gid://shopify/Product/')) {
    problems.push('MASTER_PRODUCT_ID should look like gid://shopify/Product/123456');
  }
  return problems;
}

// A view of the config that is safe to send to the browser / logs.
// IMPORTANT: never include adminToken here.
function publicConfig() {
  return {
    store: config.store,
    apiVersion: config.apiVersion,
    masterProductId: config.masterProductId,
    bundleAutomationEnabled: config.bundleAutomationEnabled,
    bundleAppName: config.bundleAppName,
    hasToken: Boolean(config.adminToken),
  };
}

module.exports = { config, validateForLiveRequest, publicConfig };
