'use strict';

const { config } = require('../config');

// Small sleep helper used for backoff.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Error type whose message/details are guaranteed to be token-free and safe to
// show in the UI.
class ShopifyError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ShopifyError';
    this.details = details || undefined;
  }
}

// Pulls userErrors / mediaUserErrors out of a mutation payload, if any.
function collectUserErrors(payload) {
  if (!payload) return null;
  for (const key of ['userErrors', 'mediaUserErrors']) {
    const errs = payload[key];
    if (Array.isArray(errs) && errs.length) {
      return errs.map(
        (e) => `${(e.field || []).join('.') || '(general)'}: ${e.message}`
      );
    }
  }
  return null;
}

// Exponential backoff with jitter: ~1s, 2s, 4s, 8s, 16s (capped).
function backoffMs(attempt) {
  const base = Math.min(1000 * 2 ** (attempt - 1), 16000);
  return base + Math.floor(Math.random() * 250);
}

// Reads a short, token-free snippet of an error response body for diagnostics.
async function safeBody(res) {
  try {
    const t = await res.text();
    return t.slice(0, 300);
  } catch {
    return undefined;
  }
}

// Runs a GraphQL operation against the Admin API.
// Handles: transport errors, HTTP 429/5xx, and Shopify cost-based THROTTLED
// responses — all retried with exponential backoff. The access token is only
// ever sent in the request header and never appears in thrown errors.
async function shopifyGraphQL(query, variables = {}, opts = {}) {
  const maxRetries = opts.maxRetries ?? 5;
  let attempt = 0;

  while (true) {
    attempt += 1;
    let res;
    try {
      res = await fetch(config.graphqlEndpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Token sent ONLY here — never logged.
          'X-Shopify-Access-Token': config.adminToken,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (networkErr) {
      if (attempt <= maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new ShopifyError('Network error talking to Shopify.', {
        reason: networkErr.message,
      });
    }

    // Retry transient transport statuses.
    if (res.status === 429 || res.status >= 500) {
      if (attempt <= maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new ShopifyError(`Shopify returned HTTP ${res.status} after retries.`, {
        status: res.status,
        body: await safeBody(res),
      });
    }

    if (!res.ok) {
      // Covers 401/403/404/422 etc. The response body never contains our token,
      // so include a trimmed snippet — it distinguishes a real auth failure from
      // e.g. a network egress allowlist block ("Host not in allowlist: ...").
      const body = await safeBody(res);
      const hint =
        res.status === 401 || res.status === 403
          ? 'Likely a bad/expired token, a missing scope, or a network egress/allowlist block.'
          : 'Unexpected response from the endpoint.';
      throw new ShopifyError(`Request failed (HTTP ${res.status}). ${hint}`, {
        status: res.status,
        body,
      });
    }

    const json = await res.json();

    // Cost-based throttling shows up as a top-level error with code THROTTLED.
    const throttled =
      Array.isArray(json.errors) &&
      json.errors.some((e) => e.extensions && e.extensions.code === 'THROTTLED');
    if (throttled) {
      if (attempt <= maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new ShopifyError('Shopify throttled the request (rate limit) repeatedly.', {});
    }

    // Any other top-level GraphQL error is fatal for this call.
    if (Array.isArray(json.errors) && json.errors.length) {
      throw new ShopifyError('GraphQL error from Shopify.', {
        messages: json.errors.map((e) => e.message),
      });
    }

    return json.data;
  }
}

// Uploads raw bytes to a staged target returned by stagedUploadsCreate.
// The "file" field MUST be appended last, after all of Shopify's parameters.
async function uploadToStagedTarget(target, file) {
  const form = new FormData();
  for (const param of target.parameters) form.append(param.name, param.value);
  form.append('file', new Blob([file.buffer], { type: file.mimeType }), file.filename);

  const res = await fetch(target.url, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // The storage provider's body is not sensitive; trim it for context.
    throw new ShopifyError('Failed to upload image bytes to the staged target.', {
      status: res.status,
      body: body.slice(0, 500),
    });
  }
}

module.exports = { shopifyGraphQL, uploadToStagedTarget, collectUserErrors, ShopifyError };
