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

> **API version:** pinned to **2025-10** via `SHOPIFY_API_VERSION`. Each mutation
> is commented in `src/shopify/queries.js`. Signatures were verified against
> `https://shopify.dev/docs/api/admin-graphql/2025-10` — re-check there if you
> bump the version, as argument names and media mutations have changed between
> versions.

---

## Requirements

- **Node.js 18.17+** (uses the built-in `fetch`/`FormData`; Node 20/22 also fine).
- A Shopify store where you can create a **custom app** (store owner / staff with
  app-development permission).

---

## 1. Create the Shopify custom app + scopes

1. In Shopify admin: **Settings → Apps and sales channels → Develop apps**.
   (If you don't see it, click **Allow custom app development** first.)
2. **Create an app** → give it a name like `Product Launcher`.
3. Open **Configuration → Admin API integration → Configure** and grant these
   **Admin API access scopes**:

   | Scope | Why |
   | --- | --- |
   | `read_products` | Read the master product + variants |
   | `write_products` | Duplicate, update template/title/status, set prices, attach media |
   | `write_files` | Upload the design images (staged uploads) |
   | `read_publications` | Find the Online Store publication |
   | `write_publications` | Publish / schedule the product |

4. **Save**.

---

## 2. Get and store the admin token

1. On the app's **API credentials** tab, click **Install app**.
2. Copy the **Admin API access token** (shown once, starts with `shpat_…`).
3. Paste it into your local `.env` as `SHOPIFY_ADMIN_TOKEN` (next section).

> You paste this yourself, locally. It is never committed, logged, printed, or
> shown in the UI. If you ever leak it, **uninstall/reinstall** the app to rotate it.

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
SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2025-10
MASTER_PRODUCT_ID=gid://shopify/Product/1234567890

# Bundle extension point (see below)
BUNDLE_AUTOMATION_ENABLED=false
BUNDLE_APP_NAME=your bundle app

PORT=3000
```

`.env` is git-ignored. Never commit it.

---

## 5. Run it

```bash
npm install
npm start
```

Open **http://localhost:3000**.

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

### Bundle app (the big one)

`productDuplicate` only clones **native Shopify** data. If your product page has
a bundle (e.g. "1 Flag / 2 Flags") powered by a third-party app, that config
lives in the app and is **not** copied.

- Default: `BUNDLE_AUTOMATION_ENABLED=false` → the success card reminds you to
  *"Set up the bundle manually for this product in `<BUNDLE_APP_NAME>`."*
- To automate: set `BUNDLE_AUTOMATION_ENABLED=true` and implement
  **`applyBundle(newProductId)`** in **`src/bundle.js`** using your bundle app's
  API. Keep any app token in `.env` (e.g. `BUNDLE_APP_TOKEN`) — never hardcode it.

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

- The admin token is read from `process.env` only. It is **never** committed,
  logged, returned to the browser, or included in error messages.
- `.env` is in `.gitignore`; only `.env.example` (no real values) is committed.
- The server only exposes non-secret config (`/api/config` returns store, API
  version, master id, and bundle settings — never the token).
- This is an **internal, local** tool. It has no auth of its own — run it on
  your machine, not on a public server.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `Shopify rejected the request (auth/scope)` | Token wrong/expired, or a scope is missing. Re-check [scopes](#1-create-the-shopify-custom-app--scopes), reinstall the app, update `.env`. |
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
├── public/                   # single-page UI (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src/
    ├── config.js             # loads + validates env (token never leaves here)
    ├── bundle.js             # applyBundle() extension-point stub
    ├── routes/
    │   └── launch.js         # POST /api/launch (multipart upload + validation)
    └── shopify/
        ├── client.js         # GraphQL client: throttle/HTTP retry, staged upload
        ├── queries.js        # all GraphQL operations (commented, version-pinned)
        └── launch.js         # the launch orchestration (duplicate → publish)
```
