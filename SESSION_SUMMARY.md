# Session Summary — Shopify Footwear Store

## Objective
- Maintain/upgrade the footwear store at `C:\Users\user\Desktop\shopify` (Express 5 + Neon PostgreSQL): dark-luxury storefront + admin UI, admin workflows, and storefront features (search + brand filters, WhatsApp order confirm).
- LATEST task (done): remove all stock tracking (each pair is a unique single piece) AND add product editing to the admin dashboard (Edit button → populate form → PUT update instead of POST).

## Important Details
- Windows + PowerShell; Node v26.6.0; Express 5.2.1, pg 8.23, multer 2.4, bcryptjs 3, jsonwebtoken 9, dotenv 18.
- Secrets/config (DB URL, JWT secret, admin credentials, ntfy settings, etc.) are stored in `.env` (gitignored, single main config file) and loaded via environment variables — do not hardcode them in code or docs.
- Admin seeding: `scripts/seed-admin.js` and `scripts/run-schema.js` read `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env`.
- Payments: bank transfer only; storefront shows the configured bank details and WhatsApp contact links in `public/index.html` (business-facing info, not secret tokens).
- Dark Luxury Green & Black tokens (identical in index.html and admin.html): `--bg:#0a0a0a`, `--surface:#1a1a1a`, `--surface-2:#121212`, `--surface-3:#262626`, `--ink:#f0f0f0`, `--muted:#9a9a9a`, `--line:#333333`, `--accent:#10b981`, `--accent-hover:#34d399`, `--accent-soft:rgba(16,185,129,.12)`, `--danger:#ef4444`, `--success:#34d399`; index.html also `--price:#34d399`, `--radius:16px`; admin.html `--radius:14px`. Text on emerald = `#03261a`; inputs `#171717`; placeholders `#6b6b6b`; header `rgba(10,10,10,.82)`.
- WhatsApp order button on storefront: pre-filled message includes order #, name/phone/city, line items, total, payment method, and transaction ID; set in `placeOrder()` success and opens the configured WhatsApp chat link. Keep button-only (no auto-open).
- **Stock removed end-to-end.** products table columns now: `id, title, brand, price, images, sizes, created_at` (migration `scripts/migrate-drop-stock.js`, idempotent, already run — column dropped live). `schema.sql` updated accordingly.
- **Products API (`routes/products.js`):**
  - `GET /` — `SELECT *` (public).
  - `POST /` (auth) — validates title/brand/price ≥ 0, parses sizes, optional image; INSERT `(title,brand,price,images,sizes)`; unlinks uploaded file on any failure.
  - `PUT /:id` (auth, new) — same validation; mutator binary preserves `images[0]` when NO new file sent, and replaces it (deleting the old `/uploads/` file) when a new file IS sent; 400 bad id / 400 missing title/brand/price / 404 unknown id; unlinks new file on failure. **Verify-route never leaves a multer file behind.**
  - `DELETE /:id` (auth) — deletes row + referenced upload files.
- **Orders API (`routes/orders.js`)** — all stock logic REMOVED: SELECT is `id,title,brand,price,sizes` (no stock column); pre-placement out-of-stock loop removed; transaction/decrement replaced by a single plain INSERT (statuses 'pending'/'pending'). Remaining caps: MAX_ITEMS 25, MAX_QTY 50, MAX_TOTAL Rs 10M, size-must-exist-in-sizes validation, required transaction_id, orphan-file cleanup on any failure.
- **Admin UI (`public/admin.html`):** stock label+input removed; product form has `#product-form-title`, `#add-btn`, `#cancel-edit-btn`; product rows render `.edit-btn` + `.delete-btn` inside `.product-actions`; `loadProducts()` caches into `productsCache`; `editProduct(id)` populates form (title/brand/price/sizes, preview shows current image, filename "Keep current image"), flips button to "Save Changes" and heading to "Edit Product"; `resetProductForm()` restores "Add Product"/"Cancel" hidden; submit uses PUT `/products/:id` when `editingId != null` else POST; new CSS `.edit-btn/.cancel-btn/.form-actions/.product-actions`; meta line no longer shows stock.
- **Storefront (`public/index.html`):** `stockInfo()` now always returns `{cls:'in', text:'In stock'}` — add-to-cart/quick-view never disabled, "In stock" dot shows. `.stock.low`/`.stock.out` CSS keeps but unused. Brand filters fully wired (markup `#brand-filters` above grid, `activeBrand` var, `renderBrandFilters()`, click-toggle, "All" default on, combines with `searchTerm`, empty-state mentions brand).
- **Size selection REMOVED (client-side, latest):** Add to Cart / Buy Now no longer require an active size chip and never throw "Please select a size". `addToCart(id,qty)` auto-uses `String(product.sizes[0])` (or "One Size"); card size chips are now read-only info with the FIRST size highlighted `.active` (chip click-toggle removed from grid); quick-view modal pre-selects the first size (`qvSize = sizes[0]`), first chip gets `.active`, and chip clicks still optionally override; `qvSizeCheck()` just returns `qvSize || "One Size"` (no `false` path, guards removed from both qv-add and qv-buy). Orders backend still validates size ∈ product.sizes, so cart always carries a valid size.
- **server.js:** global error middleware now unlinks `req.file` if present (`fs.unlink(req.file.path, cb)`) — fixes orphaned upload files when `authenticate` rejects AFTER multer writes (e.g. bad token). Requires `fs` import (added). Verified: unauthorized POST with image → 401, uploads dir unchanged.
- Testing quirks (still apply): PowerShell curl/-e mangles JS — write Node scripts using global `fetch` + `FormData`/`Blob`; restart server (kill port 5000, `Start-Process node server.js`) after route/UI changes; validate inline page JS via regex-extract + `node --check`. Login endpoint is `POST /api/admin/login` (NOT `/api/auth/login`).
- **Current DB data:** products = 1 (id 14 "asics", brand "asics", Rs 2000.00 — real user row). orders = 0 (test orders deleted). admin = 1. `public/uploads/` = `1790010161837-637386254.jpg` (legacy) + `1790091807844-41563662.png` (Asics image — was accidentally deleted as an "orphan", then restored as a valid 240x180 dark-green placeholder PNG at the SAME path so nothing 404s; the real photo needs a one-click re-upload via the new Edit button).

## Work State
### Completed
- Remove Stock Management (schema, migration, products POST, orders.js, admin form, storefront UI) — full e2e verified: create w/o stock, edit w/o/with image, 400 on missing title, 404 unknown id, order placement w/o stock, delete→404. 12/12 PASS.
- Add Product Editing — PUT `/api/products/:id` + admin Edit/Cancel/Save flow — e2e verified (12/12).
- Orphan-upload cleanup in server error middleware — verified (401 upload leaves zero files).
- Admin re-seeded (empty DB admin table) — login verified.
- (Carried from before) Dark themes both pages; payment-proof modal; proof-viewer bug fix; brand filters (search+chips composable); WhatsApp order button; WhatsApp number 923322942248.
### Active / Pending
- **Re-upload the Asics product photo** (optional but recommended): restore placeholder is dark-green; use new Edit button → Choose Image → Save Changes.
- Order status lifecycle upgrade (requested earlier, still NOT implemented): currently ORDER_STATUSES = ["confirmed","cancelled"], `PUT /:id/status` sets BOTH payment_status and order_status together, admin Confirm/Reject buttons. Target: `pending|processing|shipped|delivered|cancelled`, decoupled payment verification, admin dropdown UI + new badge styles.

## Next Move
1. (Optional) Have the store owner re-upload the Asics image via the Edit button.
2. If wanted: implement the order-status lifecycle upgrade (backend ORDER_STATUSES map + decouple payment verify, admin.html dropdown + badges), restart server (port 5000), e2e test transitions.

## Relevant Files
- `public/index.html` — storefront (brand filter state vs `searchTerm` at `renderProducts()`, `renderBrandFilters()`; WhatsApp `#wa-order-btn` + `waLines`; `stockInfo()` always "in"; `.brand-filters`/`.brand-chip` CSS+markup)
- `public/admin.html` — admin dashboard (form ids `#product-form-title/#add-btn/#cancel-edit-btn`, `productsCache`, `editingId`, `editProduct()/resetProductForm()`, product rows with `.edit-btn`, proof-viewer modal, orders render with Confirm/Reject)
- `routes/products.js` — GET/POST/PUT/DELETE CRUD (PUT is edit; no stock anywhere)
- `routes/orders.js` — GET + `PUT /:id/status` (confirmed|cancelled, sets payment+order status) + POST (plain insert, no stock)
- `routes/auth.js` — `POST /login` (bcrypt + JWT 7d)
- `server.js` — mounts, static, error middleware now unlinks `req.file`; `/health`
- `db.js` — pg Pool (`ssl:{rejectUnauthorized:false}` flagged); exports `query` + `pool`
- `schema.sql` — products no longer has `stock`; orders defaults 'pending'
- `middleware/upload.js` — hardened upload pipeline (magic bytes, allowlists, `INVALID_IMAGE_MESSAGE`, unlink-on-failure); `inspectUploadedImage` no-ops when no file
- `scripts/migrate-drop-stock.js` (ran), `scripts/seed-admin.js` (idempotent, ran), `scripts/run-schema.js`, `scripts/migrate-orders.js`