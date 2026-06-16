'use strict';

// Loads and validates configuration from environment variables.
// SECURITY: secrets are read from process.env ONLY. Tokens / client secrets are
// never logged, never returned to the browser, and never put in error messages.

require('dotenv').config();

const DEFAULT_API_VERSION = '2025-10';

const config = {
  store: (process.env.SHOPIFY_STORE || '').trim(),

  // --- Auth (two supported modes) -----------------------------------------
  // 1) Dev Dashboard app (the 2026 default): client credentials grant. The tool
  //    exchanges these for a short-lived access token automatically.
  clientId: (process.env.SHOPIFY_CLIENT_ID || '').trim(),
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
  // 2) Legacy custom app static token (still works if you already have one).
  adminToken: process.env.SHOPIFY_ADMIN_TOKEN || '',

  apiVersion: (process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim(),
  masterProductId: (process.env.MASTER_PRODUCT_ID || '').trim(),
  bundleAutomationEnabled:
    String(process.env.BUNDLE_AUTOMATION_ENABLED || 'false').toLowerCase() === 'true',
  bundleAppName: (process.env.BUNDLE_APP_NAME || '').trim(),
  port: Number(process.env.PORT || 3000),
};

// The Admin GraphQL endpoint for the configured store + pinned version.
config.graphqlEndpoint = () =>
  `https://${config.store}/admin/api/${config.apiVersion}/graphql.json`;

// The OAuth token endpoint used by the client credentials grant.
config.tokenEndpoint = () => `https://${config.store}/admin/oauth/access_token`;

// Which authentication strategy is active. Client credentials win if present
// (the modern, self-refreshing path); otherwise a legacy static token; else none.
function authMode() {
  if (config.clientId && config.clientSecret) return 'client_credentials';
  if (config.adminToken) return 'static_token';
  return 'none';
}

// Returns human-readable problems with the current config. Used to fail fast
// on real (non dry-run) requests; dry-run does not require credentials.
function validateForLiveRequest() {
  const problems = [];
  if (!config.store) {
    problems.push('SHOPIFY_STORE is not set in .env');
  } else if (!config.store.endsWith('.myshopify.com')) {
    problems.push('SHOPIFY_STORE should be your *.myshopify.com domain');
  }
  if (authMode() === 'none') {
    problems.push(
      'No credentials: set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard app) ' +
        'or SHOPIFY_ADMIN_TOKEN (legacy custom app) in .env'
    );
  }
  if (!config.masterProductId.startsWith('gid://shopify/Product/')) {
    problems.push('MASTER_PRODUCT_ID should look like gid://shopify/Product/123456');
  }
  return problems;
}

// A view of the config that is safe to send to the browser / logs.
// IMPORTANT: never include secrets (clientSecret, adminToken, access tokens).
function publicConfig() {
  return {
    store: config.store,
    apiVersion: config.apiVersion,
    masterProductId: config.masterProductId,
    bundleAutomationEnabled: config.bundleAutomationEnabled,
    bundleAppName: config.bundleAppName,
    authMode: authMode(),
    hasCredentials: authMode() !== 'none',
  };
}

module.exports = { config, validateForLiveRequest, publicConfig, authMode };
