# 🚀 Product Launcher

A small **local** internal tool that, with one button press, clones your
existing Shopify "master" product into a brand-new product — same custom page
layout (template), same size variants, same pricing structure — but with a
**new title**, **new design image(s)**, and an **optional price override**. It
can save the clone as a draft, publish it immediately, or **schedule** it to go
live on a future date.

Built for a daily "Day 1 / Day 2 / Day 3…" POD content series where each video
launches a new design and you need the matching Shopify product in ~1 minute.

---

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [1. Create the Shopify custom app + scopes](#1-create-the-shopify-custom-app--scopes)
- [2. Get and store the admin token](#2-get-and-store-the-admin-token)
- [3. Find your master product id](#3-find-your-master-product-id)
- [4. Configure `.env`](#4-configure-env)
- [5. Run it](#5-run-it)
- [Using the tool](#using-the-tool)
- [Extension points](#extension-points)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

---

## How it works

When you press **Launch product**, the backend runs this sequence
(`src/shopify/launch.js`):

1. **`productDuplicate`** from `MASTER_PRODUCT_ID` with the new title,
   `includeImages: false`, `newStatus: DRAFT`, `synchronous: true`.
2. **Verify `templateSuffix`** matches the master (this field controls the
   custom page layout). It normally carries over on duplicate; if not, the tool
   runs a `productUpdate` to set it.
3. **Upload the new image(s)** — `stagedUploadsCreate` → upload the bytes to the
   returned storage target → attach the media via `productUpdate(media:)`
   (the current replacement for the deprecated `productCreateMedia`).
4. **Price override** (optional) — `productVariantsBulkUpdate` sets the price on
   every variant.
5. **Publish**:
   - **Active now** → `productUpdate status: ACTIVE` **and** `publishablePublish`
     to the Online Store (status alone does not publish to a sales channel).
   - **Schedule** → find the Online Store publication id, then
     `publishablePublish(id, { publicationId, publishDate })`.
   - **Draft** → leave it as `DRAFT`.
6. **Return** the new product's admin URL, storefront URL, and any warnings
   (including the bundle reminder).

> **Authentication:** every call uses the `X-Shopify-Access-Token` header. With a
> Dev Dashboard app, `src/shopify/auth.js` exchanges your Client ID + Secret for a
> 24h token (client credentials grant) and refreshes it automatically; a legacy
> `shpat_` token is used directly. See [Get and store your
> credentials](#2-get-and-store-your-credentials).

> **API version:** pinned to **2025-10** via `SHOPIFY_API_VERSION`. Each mutation
> is commented in `src/shopify/queries.js`. Signatures were verified against
> `https://shopify.dev/docs/api/admin-graphql/2025-10` — re-check there if you
> bump the version, as argument names and media mutations have changed between
> versions.

---

## Requirements

- **Node.js 18.17+** (uses the built-in `fetch`/`FormData`; Node 20/22 also fine).
- A Shopify store + a Shopify account that can create an app in the **Dev
  Dashboard** (dev.shopify.com).

> **Heads up — Shopify changed this on 2026-01-01.** You can no longer create
> *legacy custom apps with a permanent `shpat_` token* from the store admin. New
> apps live in the **Dev Dashboard** and give you a **Client ID + Client Secret**,
> which you exchange for a short-lived (24h) access token via the **client
> credentials grant**. **This tool does that exchange and refresh for you** — you
> just provide the Client ID + Secret. (If you still have a working legacy
> `shpat_` token, [Option B](#option-b-legacy-static-token) also works.)

---

## 1. Create the Dev Dashboard app + scopes

1. Go to **https://dev.shopify.com** → **Apps** → **Create app** (name it
   `Product Launcher`). Connect it to your store/organization.
2. In the app's **API access / scopes** configuration, grant:

   | Scope | Why |
   | --- | --- |
   | `read_products` | Read the master product + variants |
   | `write_products` | Duplicate, update template/title/status, set prices, attach media |
   | `write_files` | Upload the design images (staged uploads) |
   | `read_publications` | Find the Online Store publication |
   | `write_publications` | Publish / schedule the product |
   | `write_discounts` | *Optional* — only if you automate adding products to a product-scoped volume discount (see [Bundle](#bundle-the-old-glory-theme)) |

3. **Save** / release the configuration so the scopes are active.

> The client credentials grant issues a token **for the store the app is
> installed on / owned by**. Make sure the app is associated with your store.

---

## 2. Get and store your credentials

### Option A — Dev Dashboard app (recommended)

1. Dev Dashboard → your app → **Settings** → copy the **Client ID** and
   **Client Secret**.
2. Put them in your local `.env`:
   ```dotenv
   SHOPIFY_CLIENT_ID=your-client-id
   SHOPIFY_CLIENT_SECRET=your-client-secret
   ```
3. That's it — the tool calls `POST /admin/oauth/access_token`
   (`grant_type=client_credentials`) to mint a 24h `shpat_…` token and refreshes
   it automatically. You never paste a token.

### Option B — legacy static token

Only if you already have a working permanent token from an older custom app:
```dotenv
SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> **Don't confuse credentials.** The **Client Secret** (`shpss_…`) is *not* a
> token — it's half of what mints one. Also do **not** use a **Headless /
> Storefront** token (public or private): those only reach the read-only
> Storefront API and can't run the Admin mutations this tool needs, even though
> the private one is `shpat_…`-prefixed.

> Everything secret stays in `.env` (git-ignored). It is never committed, logged,
> printed, or shown in the UI. If you leak a secret (e.g. paste it into a chat),
> **rotate it** in the Dev Dashboard immediately.

---

## 3. Find your master product id

Open the master product in the admin. The URL ends in a number:

```
https://your-store.myshopify.com/admin/products/1234567890
                                                ^^^^^^^^^^
```

Wrap that number as a GraphQL global id for `.env`:

```
MASTER_PRODUCT_ID=gid://shopify/Product/1234567890
```

---

## 4. Configure `.env`

```bash
cp .env.example .env
```

Then edit `.env`:

```dotenv
SHOPIFY_STORE=your-store.myshopify.com

# Option A (recommended): Dev Dashboard app
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
# Option B (legacy): a permanent token instead of A
# SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

SHOPIFY_API_VERSION=2025-10
MASTER_PRODUCT_ID=gid://shopify/Product/1234567890

# Bundle extension point (see below)
BUNDLE_AUTOMATION_ENABLED=false
BUNDLE_APP_NAME=

PORT=3000
```

`.env` is git-ignored. Never commit it.

---

## 5. Run it

```bash
npm install
npm run check   # read-only: confirms your token works + prints the master product
npm start
```

Open **http://localhost:3000**.

> `npm run check` is the fastest way to answer "does my token work?" — it makes no
> changes, authenticates, and prints the master product's title/status/template/
> variants. If it prints a **"Host not in allowlist"** response, that's a network
> firewall (run it on your own machine), not Shopify.
>
> Tip: `npm run dev` restarts the server on file changes.

---

## Using the tool

The single page has:

- **Mode**
  - **Duplicate master** (default) — clone `MASTER_PRODUCT_ID`.
  - **Existing product (POD)** — operate on an already-created product (e.g. one
    Printful/Printify pushed into Shopify). Skips the duplicate and just applies
    template + price + publish + bundle to that product id.
- **Product title** (required for Duplicate).
- **Design image(s)** — one or more files (required unless you're in Existing mode).
- **Price override** (optional) — applied to every variant.
- **Publish** — `Draft` / `Active now` / `Schedule` (the date picker appears for
  Schedule). Times are sent in your browser's timezone.
- **Dry run** — logs the exact calls and inputs it *would* make and changes
  **nothing** (no Shopify calls at all). Great for testing safely; works even
  without a token.
- **Async duplicate** — uses `synchronous: false` and polls the operation; only
  needed if your master is huge and the duplicate times out.

On success you get a card with clickable **admin** and **storefront** links, plus
any reminders (e.g. the manual bundle reminder). Products launched during the
session are listed at the bottom.

---

## Extension points

These are built as clearly-marked stubs/toggles.

### Bundle (the "Old Glory" theme)

Good news: in your **"Old Glory"** theme the "1 Flag / 2 Flags"
(*Single / Patriot Pair / Family Set*) bundle is **not a third-party app**. It is
built natively into the theme as section blocks of `type: "bundle"` in
`sections/main-product.liquid`, configured on the **product template**
(`product.flag.json` / `product.landing.json`).

Because those blocks live on the **template** (shared by every product using that
`templateSuffix`), they **copy across automatically** the moment the new
product's `templateSuffix` matches the master — which the launch flow already
guarantees in step 2. So normally there is **nothing to do**.

The one piece that does *not* live on the product is the **savings**: the theme's
own help text says to pair the bundle cards with a **Shopify automatic volume
discount** (Admin → **Discounts → Amount off products → quantity minimum**).

- If that discount targets **all products** (or a collection the new product
  joins) → nothing to do; it just works.
- If it targets **specific products** → add the new product to the discount.

The success card reminds you to verify this after each launch.

**Optional automation** (only needed for a product-scoped discount): set
`BUNDLE_AUTOMATION_ENABLED=true`, add `AUTOMATIC_DISCOUNT_ID` and the
`write_discounts` scope, and implement **`applyBundle(newProductId)`** in
**`src/bundle.js`** (a `discountAutomaticBasicUpdate` example is in the file).

### POD mode

Use **Existing product** mode for products created first in Printful/Printify
(which push mockups + variants into Shopify). The tool skips the duplicate and
applies template + price + publish + bundle to the product id you give it.

### Dry-run mode

The **Dry run** checkbox returns the planned API calls and inputs without making
any mutation. Use it to sanity-check before a real launch.

### Async duplication

If the master grows many variants/locations, `productDuplicate` can time out.
The **Async duplicate** toggle switches to `synchronous: false` and polls the
`ProductDuplicateOperation` until it completes. Synchronous remains the default.

---

## Security notes

- All secrets (client secret / admin token / minted access tokens) are read from
  `process.env` only. They are **never** committed, logged, returned to the
  browser, or included in error messages. Minted access tokens are held in memory
  and refreshed on expiry.
- `.env` is in `.gitignore`; only `.env.example` (no real values) is committed.
- The server only exposes non-secret config (`/api/config` returns store, API
  version, master id, bundle settings, and the auth *mode* — never a secret).
- This is an **internal, local** tool. It has no auth of its own — run it on
  your machine, not on a public server.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `Could not obtain an access token (HTTP 401/403)` | Wrong **Client ID / Client Secret**, or the app isn't associated with this store. Copy them again from Dev Dashboard → your app → **Settings**. Don't paste the secret into `SHOPIFY_ADMIN_TOKEN`. |
| `Request failed (HTTP 403)` … `network egress/allowlist block` | Check the `body` in the error details. If it says **"Host not in allowlist: …"** the block is your network/firewall (e.g. a sandbox with an egress allowlist), **not** Shopify — allow `*.myshopify.com`. Otherwise it's a missing scope or a Storefront token used by mistake. |
| `Could not find the Online Store publication` | The store has no Online Store channel, or the app lacks `read_publications`. |
| `MASTER_PRODUCT_ID should look like gid://...` | Wrap the numeric id: `gid://shopify/Product/123`. |
| Throttled / rate-limited | The client backs off and retries automatically; only fails after repeated throttling. |
| Images don't appear immediately | Media processes asynchronously on Shopify's side; refresh the product after a moment. |
| Storefront link 404s right after launch | For Draft/Schedule the product isn't live yet; for a custom domain the URL host may differ from `*.myshopify.com`. |

---

## Project layout

```
.
├── server.js                 # Express app entry
├── package.json
├── .env.example              # copy to .env (git-ignored)
├── .gitignore
├── README.md
├── scripts/
│   └── check.js              # `npm run check` — read-only setup self-test
├── public/                   # single-page UI (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src/
    ├── config.js             # loads + validates env; auth mode (no secrets leak)
    ├── bundle.js             # applyBundle() extension-point stub
    ├── routes/
    │   └── launch.js         # POST /api/launch (multipart upload + validation)
    └── shopify/
        ├── auth.js           # client-credentials token mint + cache/refresh
        ├── client.js         # GraphQL client: auth, throttle/HTTP retry, uploads
        ├── queries.js        # all GraphQL operations (commented, version-pinned)
        └── launch.js         # the launch orchestration (duplicate → publish)
```
