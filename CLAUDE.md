@AGENTS.md

> **Read AGENTS.md first.** This Next.js version has breaking changes from your
> training data. Before writing Next-specific code (routing, layouts, fonts,
> images, server/client boundaries, metadata), open `node_modules/next/dist/docs/`
> and verify the current API. Do not trust your priors.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# مختبرك (makhbartak)

At-home lab test ordering for Damascus and Rural Damascus. Patient picks a
ready-made package, uploads a doctor's prescription, or builds a custom set;
a nurse visits and collects samples; the lab uploads a PDF; the result lands
in the patient's phone. Four apps in one repo: Customer, Nurse, Lab, Admin.

**This is a real-Supabase production system.** Auth, orders, payments,
results, prescriptions, notifications, finance, and Stripe online checkout
all flow through Supabase + service-role API routes. The legacy "mock
prototype + USE_SUPABASE flag" world is gone — assume every read/write hits
the database.

For deeper product/design context: `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`.

---

## Product context

- Single product, four apps in one repo (see "App scope" below).
- Arabic-first, RTL, mobile-first. Desktop layouts exist for staff portals
  (admin, lab); customer + nurse are phone-shaped on every viewport.
- Brand: **Reliable · Clinical · Human.** Closer to Careem's operational
  clarity + Vezeeta's medical trust, but simpler — built for users who may
  distrust complex interfaces. Avoid e-commerce, government, and
  luxury-healthcare aesthetics (see PRODUCT.md anti-references).

## Target users

- **Patients & family members** in Damascus / Rural Damascus, age 25–60.
  Mixed mobile literacy — assume the user has never opened the app before.
  Prefer icons + short labels over paragraphs.
- **Nurses** doing home visits — phone-shaped, glanceable, gamified.
- **Lab technicians** — desktop, list + detail, upload PDFs to orders.
- **Admins** — desktop dashboard with role-based access (6 roles).

## Tech stack

| | |
|---|---|
| Framework | Next.js **16.2.4** (App Router) — APIs may differ from training data |
| Runtime | React **19.2.4** |
| Language | TypeScript **strict** (`@/*` → `./src/*`) |
| Styling | Tailwind CSS **v4** + `tailwind.config.ts` for tokens |
| Animation | framer-motion **12** |
| Icons | lucide-react **1.x** (very early major — verify icon names exist) |
| Primitives | @radix-ui/react-dialog, @radix-ui/react-slot |
| Utilities | clsx, tailwind-merge (use `cn()` from `@/lib/utils`) |
| Variants | class-variance-authority |
| Font | Readex Pro (next/font/google) |
| Database | Supabase (Postgres + Storage + Auth) |
| Payments | Stripe (REST via fetch, no SDK dep). Client uses `@stripe/stripe-js` + `@stripe/react-stripe-js` |
| Package manager | **npm** (package-lock.json committed) |

No tests are configured. No state library — `useSyncExternalStore` over
module-level mutable stores in `src/lib/*`.

## Important commands

```bash
npm run dev      # next dev — http://localhost:3000
npm run build    # next build — must pass before declaring a task done
npm run lint     # eslint (next/core-web-vitals + next/typescript)
npm start        # serve a built app
```

Routes: `/` (customer), `/admin`, `/nurse`, `/lab`. All four gate behind
`useSession()` from `lib/auth.ts` and render their portal's `LoginForm`
when there is no matching role session. `/admin`, `/nurse`, `/lab`, and
`/payment` carry `metadata.robots = { index: false }` via per-portal
`layout.tsx` files. The customer marketing route is the only indexed page;
`src/app/robots.ts` and `src/app/sitemap.ts` reflect that.

---

## Architecture — the big picture

### Three-tier read/write contract

Every meaningful mutation flows the same way:

```
Client component
  → mutator in src/lib/store.ts (or sibling: profile.ts, payment-pref.ts, …)
    → optimistic local update (useSyncExternalStore)
    → src/lib/orders-api.ts / customer-api.ts / nurse-api.ts (apiX wrapper)
      → POST/PATCH /api/<route>
        → requireAuthedUser / requireAdmin / requireCustomerSelfOrAdmin / requireNurseSelfOrAdmin
        → service-role Supabase client (lib/supabase/server-admin.ts, "server-only")
          → SECURITY DEFINER RPC (supabase/migrations/*.sql)
            → tables, triggers, ledger
```

Hard rules:

- The **service-role client never imports from a client-reachable file**.
  `lib/supabase/server-admin.ts` is `import "server-only"`-protected. Only
  `app/api/**/route.ts` files import it.
- **RPCs own state changes.** Routes are thin: validate input, check
  ownership, call RPC, return canonical hydrated row. Don't compute
  business state in TypeScript when the RPC can do it atomically.
- **Idempotency is layered**: client-side debounce → API idempotency keys
  (order creation) → DB partial unique indexes (one paid payment per
  order, one cash_collected per order, one commission_earned per order,
  one earning per order, one webhook event per provider event id).
- **The webhook is the only path that flips an online payment to paid.**
  Frontend success is advisory; the customer payment screen polls
  `/api/orders/[id]/payment-status` until `payments.status` and
  `orders.payment_status` both reflect the webhook's effect.

### Finance ledger (Phase 4.1 → 5.2)

- `payments` (one paid-ish row per order, partial unique guards): the
  per-collection record. Provider snapshot lives here for online
  (`provider`, `provider_ref`, `charged_amount`, `provider_currency`,
  `exchange_rate`, `provider_metadata`).
- `nurse_wallets` + `nurse_wallet_transactions`: nurse-side ledger.
  Types: `cash_collected | commission_earned | settlement_paid |
  adjustment | cash_refund | refund`. `commission_rate_snapshot` is
  stamped at accrual.
- `lab_wallets` + `lab_wallet_transactions`: lab-side ledger. Types:
  `earning | settlement_paid | adjustment`. Every earning carries a
  per-item `payout_snapshot` jsonb breakdown.
- `lab_payout_rules`: 3-tier resolver: test-specific →
  lab-default → `app_settings.lab_default_payout_*`. Used by
  `accrue_lab_earning`.
- `payment_provider_events`: webhook idempotency log keyed on Stripe
  event id. Result tags: `received | confirmed | failed | refunded |
  ignored | no_match | duplicate | confirm_error | failed_error |
  refund_error`. Retryable error tags trigger re-runs on Stripe replay.
- Currency is hard-coded SYP at the order/wallet level. Online charges
  store the provider-currency snapshot but the SYP amount is
  authoritative.

Order status flips to `completed` are guarded by triggers:
`tg_orders_accrue_commission` runs `accrue_nurse_commission` and
`accrue_lab_earning`, both of which gate on `payment_status='paid'`. The
strict payment gate (mig 029) refuses `set_order_status_admin` calls that
try to advance an unpaid order to `sample_collected+`.

### Customer-facing payment lifecycle

```
created → assigned → on_the_way → arrived
   → (cash) nurse "تأكيد التحصيل" → POST /cash-collected
            → payments(paid_by_nurse) + orders.payment_status=paid + wallet credit
   → (online) StripePaymentScreen → /api/payments/stripe/create-intent
            → Stripe Elements → confirmPayment(redirect: if_required)
            → Stripe webhook → /api/webhooks/stripe
            → payments(verified_by_admin) + orders.payment_status=paid
            (NO wallet write — nurse never held the cash)
   → sample_collected → sent_to_lab → lab_processing → completed
```

Customer-facing status strip has 6 buckets:
`received → confirmed → on_the_way → sample_collected → in_lab → completed`.
A 7th implicit `needs_attention` surfaces failures. Internal
`result_ready` is mapped to `completed` for customers.

### Cross-cutting infra

- **Auth**: `src/lib/route-auth.ts` (`requireAuthedUser`, `requireAdmin`,
  `requireCustomerSelfOrAdmin`, `requireNurseSelfOrAdmin`).
  `RouteSession` carries `role`, `customerId | nurseId | labId | adminRole`,
  and `phone`. Customer client wraps it via `useSession()` from
  `src/lib/auth.ts`.
- **Logger**: `src/lib/logger.ts` redacts secrets (Bearer/sk_*/whsec_*
  patterns + a key-name allow-list) and forwards to Sentry when
  `SENTRY_DSN` is set (dynamic import — no hard dep).
- **Safe error responses**: `src/lib/api/safe-error.ts` — wraps RPC errors,
  surfaces P0001 Arabic copy verbatim to clients, hides everything else.
- **Rate limiting**: `src/lib/api/rate-limit.ts` — in-memory token bucket.
  Single-instance only; swap to Upstash/Vercel KV before multi-replica
  deploy. Applied to forgot-password, stripe/create-intent,
  admin/notifications/broadcast, notifications/admin-alert.
- **Upload safety**: `src/lib/payments/magic-bytes.ts` sniffs PNG/JPEG/
  WebP/PDF (and detects + rejects SVG). All upload routes (admin media,
  customer prescriptions, lab result files) sniff bytes; the browser-
  supplied `file.type` is never trusted.
- **Stripe**: `src/lib/payments/stripe.ts` — REST + HMAC signature
  verification. No `stripe-node` dependency.
- **Per-route error UI**: `src/app/error.tsx` and `src/app/not-found.tsx`
  give Arabic-friendly fallbacks. The nurse app additionally has its own
  `NurseErrorBoundary`.

### Migrations index (read in order)

- 001–005: enums, tables, indexes, RLS, storage buckets.
- 007: `place_order_admin` RPC.
- 010: Phase 1 demo customers seed.
- 011: `order_public_number_seq` + `customerOrderRef`.
- 012: `set_order_status_admin`.
- 013: lab result files RPCs.
- 014: nurse + lab assignment RPCs (`auto_assign_order`).
- 015: order action RPCs (notes, coupon, cancel, reschedule, verify,
  force-complete, payment-status).
- 016: nurse profile + prep + shortage requests.
- 017: lab issues + lab self-edit + settlements.
- 018: customer profile RPCs.
- 019: catalog admin RPCs (tests, packages, instructions, nurse_tools,
  coupons, content_pages, sliders, app_settings).
- 020: notifications + admin activity log.
- 023: `arrived` order status enum value.
- 024: nurse online status.
- 025: branding + ratings.
- 026/027: nurse gamification + adjust.
- 028: Phase 3.5 hardening (Stripe settings, payment gate v1).
- 029: strict payment gate (cash + online).
- 030: prescription pipeline + bucket.
- 031: nurse wallet + commission + settlement RPCs.
- 032: P0 finance fixes (place_order seeds pending payment, refuse
  legacy paid flips, cancel reverses paid orders, force-complete refuses
  unpaid).
- 033: Phase 4.2 — verification + refunds (`paid_by_nurse`,
  `verified_by_admin`, `partially_refunded`, refund/cash_refund txns).
- 034: online payments scaffold (`provider_*` columns, webhook RPCs,
  payment_provider_events).
- 035: Phase 5.1 launch blockers (provider_ref unique, app_settings
  singleton, activity log + public_number indexes).
- 036: Phase 5.2 lab finance (`lab_wallets`, `lab_wallet_transactions`,
  `lab_payout_rules`, accrual trigger extension).

## Project structure

```
src/
  app/
    layout.tsx                    # RTL <html lang="ar" dir="rtl">, Readex Pro
    page.tsx                      # Customer app (auth + tabbed shell)
    error.tsx, not-found.tsx      # Arabic fallbacks
    robots.ts, sitemap.ts         # Public-only
    admin/page.tsx + layout.tsx   # noindex
    nurse/page.tsx + layout.tsx   # noindex
    lab/page.tsx + layout.tsx     # noindex
    api/                          # All server routes
  components/
    ui/                           # Button, BottomSheet, Card, Badge, Input, ...
    layout/                       # BottomNav, SideNav
    auth/                         # LoginForm + per-portal wrappers
    home/, booking/, cart/        # Customer flow
    payment/StripePaymentScreen   # Online checkout (Elements)
    order/                        # OrdersList, OrderDetails, OrderSuccess
    nurse/                        # NurseApp, NurseWallet, NurseErrorBoundary
    lab/                          # LabPortal, LabFinanceSection
    admin/                        # AdminDashboard, OCC, FinanceAdmin, ...
  lib/
    types.ts                      # All TS interfaces, status unions
    route-auth.ts                 # Server auth guards
    auth.ts                       # Customer-side useSession
    store.ts                      # Module-level orders store, mutators
    supabase/server-admin.ts      # service-role; "server-only" gated
    supabase/queries/orders.ts    # Hydrators + signed-URL enricher
    payments/{stripe,magic-bytes} # Provider helpers
    api/{safe-error,rate-limit}   # Cross-cutting route helpers
    logger.ts
supabase/migrations/              # Source of truth for the DB
```

The customer app is a **single client component** (`src/app/page.tsx`) that
switches views via local state — no nested routes for the booking flow.
`AdminDashboard.tsx` is intentionally one large file with internal
sub-components and centralized state. Don't blow it apart "for hygiene";
do split when a section grows new responsibilities.

## Environment variables

Server-only (never expose to client):

| Var | Used by | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | every API route | bypasses RLS |
| `STRIPE_SECRET_KEY` | `lib/payments/stripe.ts` | `sk_test_*` / `sk_live_*` |
| `STRIPE_WEBHOOK_SECRET` | `/api/webhooks/stripe` | HMAC verify |
| `STRIPE_ONLINE_CURRENCY` | create-intent | default `USD` |
| `STRIPE_SYP_PER_PROVIDER_UNIT` | create-intent | e.g. `13000` (1 USD = 13,000 SYP). Required when Stripe is enabled |
| `SENTRY_DSN` | logger | optional; absent → console only |
| `NEXT_PUBLIC_SITE_URL` | robots.ts / sitemap.ts | canonical host |

Public Stripe settings (`enable_stripe`, `stripe_public_key`, `stripe_mode`)
live in `app_settings` and are admin-editable from Settings.

`NEXT_PUBLIC_SHOW_DEMO_CREDS=true` is REFUSED at boot in production —
`src/lib/demo-credentials.ts` throws on import.

---

## Design principles

From `PRODUCT.md` — non-negotiable:

1. **Clarity over cleverness.**
2. **One clear action per screen.**
3. **Trust through restraint.** Clinical credibility comes from spacing
   and typography, not "medical" stock icons or busy gradients.
4. **Sheets over pages.** Bottom sheet for quick choices; full-screen
   modal for complex inputs.
5. **Human feedback at every step.** Loading, success, and error states
   are warm and specific — never a bare spinner or "Error occurred."

Color rules (full table in `DESIGN.md`):
- Primary cyan `#0891B2` for links, active states, top-bar accent.
- CTA emerald `#059669` for primary action buttons and the cart badge.
- Cyan accent stays at **≤10% screen coverage** outside the hero.
- One subtle gradient permitted on the hero surface; nowhere else.
- No heavy box shadows. Cards = `border-gray-100`, no shadow.

Type rules:
- Single family: **Readex Pro**, weights 200–700.
- Minimum on-screen size: **11px**. Body 14–16px. Page titles 20–21px / 700.
- Latin/English wraps in `<span class="lat">` — renders at 92% size and 400
  weight so it stays subordinate to Arabic.

## Arabic / RTL rules

- `<html lang="ar" dir="rtl">` is set in `src/app/layout.tsx`. All pages
  inherit RTL; do not override per-component.
- **Use logical CSS properties**: `start`/`end`, `ms-*`/`me-*`, `ps-*`/`pe-*`,
  `text-start`/`text-end`. Avoid `left`/`right`, `ml-*`/`mr-*` unless you
  truly mean visual left/right.
- **Back means forward in RTL**: the back button is `ChevronRight` (→), not
  `ChevronLeft`. Use the existing `<BackButton>` from `components/ui`.
- Numbers, phone numbers, and prices stay LTR inside RTL flow:
  - `input[type="tel"]` / `input[type="number"]` are forced `direction: ltr`
    in `globals.css` — do not re-style.
  - Format prices with `formatPrice()` from `@/lib/utils` → `"59 ل.س"`.
- All primary copy (labels, CTAs, errors, empty states) is Arabic. English
  abbreviations (CBC, TSH, HbA1c) appear in `.lat` spans, smaller and lighter.
- Dates: `formatDate()` / `formatTime()` use `ar-SY` locale; relative times
  use Arabic words ("منذ X دقيقة"). Don't roll your own.

## Component conventions

- **Always prefer existing primitives** in `components/ui/`: `Button`,
  `BottomSheet`, `FullScreenModal`, `Card`, `Badge`, `StatusBadge`,
  `Input`, `Skeleton`, `BackButton`. Don't reinvent these.
- **`Button`** variants: `primary` (emerald), `secondary` (cyan), `outline`,
  `ghost`, `danger`. Sizes: `sm` h-9, `md` h-12, `lg` h-14. Always pass
  explicit `type` and rely on its built-in `aria-busy` while loading.
- **`BottomSheet`**: spring slide-up, drag handle + drag-to-dismiss past 80px,
  `bg-black/50` backdrop (no blur — perf), max height 75vh.
- **`StatusBadge`** + `ORDER_STATUS_LABELS` in `lib/types.ts` own all order
  status copy and color. Don't hard-code status strings.
- **Icons**: `lucide-react` only. SVG inline acceptable for one-offs.
  **Never use emoji** in UI.
- **Class merging**: always use `cn(...)` from `@/lib/utils`.
- **Touch targets**: minimum 44×44px (`min-h-[44px] min-w-[44px]` or `h-12+`).
- **Borders + radius**: cards `rounded-xl border-gray-100`; inputs
  `rounded-xl`; buttons `rounded-xl` (sm) / `rounded-2xl` (md+); pills
  `rounded-full`; sheets `rounded-t-2xl`.

## Motion / animation rules

- Animate **transform and opacity only**.
- Easing: `easeOut` for entrances, `easeIn` for exits. Spring physics for
  sheets and tap interactions.
- Standard durations: content fade-in 220–250ms easeOut; bottom sheet
  spring damping 32 / stiffness 320; full-screen push/pop spring damping 30
  / stiffness 300; button tap 100ms scale to 0.97; skeleton shimmer 1.5s.
- `prefers-reduced-motion` is honored globally in `globals.css` — do not
  duplicate that handling.
- **No tab-switch animations** in the customer shell — bottom-nav swaps
  are instant.

## Business rules

- **Visit shifts**: morning 8:00–10:00, evening 16:00–18:00. Configurable
  via `SYSTEM_SETTINGS` in `mock-data.ts` (constants + Arabic labels).
- **Minimum booking notice**: 120 minutes. Enforced by `getShiftConfigs()`.
- **Booking window**: today + `bookingWindowDays`. Enforced in UI AND in
  the submit handler.
- **Supported cities**: دمشق, ريف دمشق.
- **Currency**: Syrian Pound (ل.س). Format with `formatPrice()`.
- **Coupons**: server-side validation only — `/api/coupons/validate`.
- **Order status flow**: `created → priced → scheduled → confirmed →
  nurse_assigned → on_the_way → arrived → sample_collected → sent_to_lab
  → lab_processing → result_ready → completed`. Failure forks:
  `failed_to_collect`, `lab_issue`, `cancelled`.
- **Result files belong to the order, not the test** (`OrderResultFile`).
  Lifecycle: `uploaded → replaced → archived → restored`. Never destructive.
- **Patients/Addresses are per-user** and live inside the user profile
  drawer in admin — they are intentionally NOT standalone admin pages.
- **Lab confirm requires lab ownership** (Phase 5.1 P0 fix): the route
  re-checks `auth.session.labId === order.lab_id` before flipping to
  `completed`. Never trust the UI.
- **Force-complete refuses unpaid orders** by default; an explicit
  `allowUnpaid: true` exists for operational recovery and stamps
  `[unpaid_force]` in history; commission/earning RPCs gate on
  `payment_status='paid'` so unpaid force-completes never accrue.
- **Lab no sell price**: by default the lab portal hides
  `priceSnapshot` and order total; flip via `lab.revealSellPriceToLab`.
- **Lab issue customer message**: `LabIssue.customerMessageAr` is
  admin-editable; falls back to `DEFAULT_LAB_ISSUE_CUSTOMER_MESSAGE_AR`.
  Internal `description` is never exposed to the customer.

## App scope

### Customer (`/` — `src/app/page.tsx`)

- Tabs: home, orders, notifications, account.
- Three entry paths to a booking: pick a Package, upload a Prescription,
  build a Custom test set.
- Flow: Home → entry path → BookingFlow → CartScreen → (cash) OrderSuccess
  / (online) StripePaymentScreen → poll until webhook confirms → OrderSuccess.
- Mobile-shaped on every viewport.

### Nurse (`/nurse` — `components/nurse/NurseApp.tsx`)

- Phone-shaped on every viewport.
- Tabs: home (today's route + prep checklist), schedule, **wallet** (Phase
  5.2), settings.
- Day starts when the nurse confirms the prep checklist (built from
  today's tests via `buildPrepChecklist`). Persisted per day.
- Nurse notifications are a separate inbox.

### Lab (`/lab` — `components/lab/LabPortal.tsx`)

- Desktop/tablet two-pane: order list + selected order detail.
- Sections: Orders / رفع النتائج / مشاكل المخبر / **المالية** (Phase 5.2)
  / المحاسبة (legacy settlements) / إعدادات المخبر.
- Per-order: upload one or many PDFs, delete/replace, mark ready, or
  report a lab issue.

### Admin (`/admin` — `components/admin/AdminDashboard.tsx`)

- Six roles via `ROLE_PERMISSIONS` + `canAccess(role, section)`:
  `super_admin | operations_admin | lab_admin | customer_support |
  finance_admin | content_admin`.
- Sections grouped: ops, catalog, operations (field), finance, content,
  system. Centralized mutable state at the top of `AdminDashboard` so
  child sections CRUD without prop-drilling.
- Finance subtabs: نظرة عامة / محافظ الممرضين / **محافظ المخابر** (Phase 5.2)
  / **قواعد المستحقات** (Phase 5.2) / المدفوعات / التسويات / التقارير.

## Storage buckets

All buckets are private; signed URLs are minted server-side with TTL ~1h
via `enrichOrdersWithSignedUrls` or equivalent helpers.

| Bucket | Contents |
|---|---|
| `lab-results` | Lab-uploaded PDFs (one or many per order) |
| `prescriptions` | Customer-uploaded prescription images/PDFs |
| `media-library` | Admin-managed marketing assets |

## Code quality standards

- TypeScript **strict** is on. No `any`. Reuse the unions in `types.ts`.
- Prefer pure functions and small components. The big-component pattern
  (`AdminDashboard`, `NurseApp`) is allowed when it keeps related state
  co-located; new screens should still start small.
- Class strings: keep readable. Use `cn(...)`; don't inline 10-class
  ternaries when a variable would help.
- Accessibility: aria-label on icon-only controls, aria-pressed for
  toggles, aria-current for active nav, aria-busy for loading. Visible
  focus state lives in `globals.css`.
- Run `npm run lint` and `npm run build` before declaring a task done.

## What not to do

- **Don't trust your Next.js training data.** APIs in 16.x may be
  renamed, removed, or behave differently. Cross-check
  `node_modules/next/dist/docs/` and any deprecation notices.
- **Don't add emojis, gradients, or drop shadows beyond the approved
  palette.** One hero gradient max.
- **Don't push a new page where a `BottomSheet` or `FullScreenModal`
  works.**
- **Don't translate or i18n the app.** Arabic is the product, not a locale.
- **Don't hard-code status strings, role names, or shift hours.** Use the
  unions, label maps, and helpers in `lib/`.
- **Don't add per-test result PDFs** — files belong to the order.
- **Don't add comments that restate what the code does.** Only the *why*.
- **Don't add backwards-compat shims, dead exports, or `// removed`
  placeholders.** Just delete what's unused.
- **Don't bypass `cn()`** — concatenated class strings make conflicting
  Tailwind utilities silently win in the wrong order.
- **Don't override RTL or `dir="rtl"`** at the component level.
- **Don't import `lib/supabase/server-admin.ts` from any client-reachable
  module.** It's `server-only`-protected for a reason.
- **Don't accept `image/svg+xml` on uploads.** SVG carries inline scripts;
  `lib/payments/magic-bytes.ts` already rejects it on every upload route.
- **Don't add new admin-broadcast paths.** Operational alerts go through
  `/api/notifications/admin-alert` (allow-listed types, rate-limited);
  `/api/admin/notifications/broadcast` is admin-authored only.
- **Don't return raw `error.message` from a Supabase call.** Use
  `safeApiError` from `lib/api/safe-error.ts`.

## QA checklist

Run before declaring a substantive change done:

1. **Lint + build pass**: `npm run lint && npm run build`.
2. **Customer flow**: sign in, walk through Home → Package (or
   Prescription / Custom) → BookingFlow → Cart → Success (cash) and
   StripePaymentScreen → Success (online). Online payment must NOT
   complete until the webhook confirms — frontend success only triggers
   the polling phase.
3. **Wrong-portal login is blocked**: signing into `/admin` with a
   customer account shows "لا تملك صلاحية الوصول…".
4. **Logout returns to login screen** for the active portal, no stale
   state.
5. **Refresh keeps session** (Supabase cookie).
6. **Order numbers**: `HL-YYYY-NNNNNN` shows on success and in `طلباتي`.
7. **Nurse**: arrived → تأكيد التحصيل → wallet credit; subsequent retries
   refused with the Arabic gate message; advance to sample_collected
   succeeds only after collection.
8. **Lab confirm**: a lab user signed into Lab A cannot confirm Lab B's
   order (403 «لا تملك صلاحية تأكيد نتائج هذا الطلب»).
9. **Multi-PDF upload**: lab portal accepts multiple files; per-row
   استبدال + استعادة work.
10. **Auto-complete on confirm**: customer flips to "مكتمل" with PDFs at
    top; commission and lab earning rows appear in the respective
    ledgers (gated on `payment_status='paid'`).
11. **Force-complete**: refuses unpaid; `allowUnpaid:true` succeeds
    without accruing commission/earning.
12. **Refund**: partial → row goes `partially_refunded`; second refund
    closes it; second-after-full → 409.
13. **Webhook idempotency**: replay a `payment_intent.succeeded` event →
    second delivery returns `duplicate: true`. Force a transient RPC
    failure → second delivery completes the side effect.
14. **Admin Finance numbers reconcile**: net-collected matches the SQL
    sum of `payments(amount − refunded_amount) WHERE status IN paid-ish`.
15. **Mobile + desktop**: resize down to ~375px; customer + nurse stay
    phone-shaped, lab + admin reflow to desktop.
16. **RTL sanity**: numbers/prices stay LTR; back arrows point right;
    logical-property utilities used over directional ones.
17. **Reduced motion**: emulate `prefers-reduced-motion: reduce`; no
    animation stuck mid-state.

If you can't actually run the UI (e.g. headless), say so explicitly in
your hand-off rather than claiming the change works.
