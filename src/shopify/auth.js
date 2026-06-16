'use strict';

// Admin API authentication.
//
// Supports two modes (see src/config.js):
//   - client_credentials: exchange SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET
//     (Dev Dashboard app, the 2026 default) for a short-lived access token, and
//     refresh it automatically when it expires (~24h).
//   - static_token: use a legacy custom-app SHOPIFY_ADMIN_TOKEN directly.
//
// SECURITY: the client secret is sent only to Shopify's token endpoint and the
// access token only in the API header — neither is ever logged or thrown.

const { config, authMode } = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In-memory cache for a client-credentials access token.
let cache = { token: null, expiresAt: 0 };

// Exchanges client credentials for an access token. Retries transient failures
// (429/5xx/network); does NOT retry 4xx (bad credentials).
async function fetchTokenViaClientCredentials() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch(config.tokenEndpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
      });
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      continue;
    }

    const text = await res.text();

    if (!res.ok) {
      // Transient → retry; 4xx (bad creds / not allowlisted) → fail fast.
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`token endpoint HTTP ${res.status}: ${text.slice(0, 200)}`);
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
        continue;
      }
      const err = new Error(
        `Could not obtain an access token (HTTP ${res.status}). ${text.slice(0, 200)}`
      );
      err.details = { status: res.status, body: text.slice(0, 300) };
      throw err;
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('Token endpoint returned a non-JSON response.');
    }
    if (!json.access_token) {
      throw new Error('Token endpoint response did not include an access_token.');
    }

    const ttlSec = Number(json.expires_in || 86400);
    // Refresh a minute early to avoid using a token that expires mid-request.
    cache = { token: json.access_token, expiresAt: Date.now() + ttlSec * 1000 - 60000 };
    return cache.token;
  }

  throw new Error(
    `Could not reach the token endpoint: ${lastErr ? lastErr.message : 'unknown error'}`
  );
}

// Returns a valid access token for the active auth mode.
async function getAccessToken({ forceRefresh = false } = {}) {
  const mode = authMode();
  if (mode === 'static_token') return config.adminToken;
  if (mode === 'client_credentials') {
    if (!forceRefresh && cache.token && Date.now() < cache.expiresAt) return cache.token;
    return fetchTokenViaClientCredentials();
  }
  throw new Error(
    'No Shopify credentials configured. Set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET ' +
      '(Dev Dashboard app) or SHOPIFY_ADMIN_TOKEN (legacy custom app) in .env.'
  );
}

// Drops the cached token so the next call re-fetches (used after a 401).
function clearTokenCache() {
  cache = { token: null, expiresAt: 0 };
}

module.exports = { getAccessToken, clearTokenCache };
