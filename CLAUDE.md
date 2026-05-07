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

### How to read this document

Rules are tagged so a reader can tell what is uncompromising from what is
just current code. When a section uses one of these words, treat it
literally:

- **Invariant** — must never be violated; affects money, security,
  auditability, or data correctness. Tightening is welcome; loosening
  needs a deliberate decision.
- **Constraint** — important rule, but a violation is recoverable. Push
  back before changing.
- **Implementation** — true today; will plausibly change without breaking
  correctness. Don't cargo-cult, don't rewrite for sport.
- **Guideline** — preferred approach, judgment call. Reasons can override.

Earlier drafts of this document mixed these together. If you read a rule
that sounds absolute but isn't tagged, prefer the spirit: protect money,
auditability, and PII; keep the rest negotiable.

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

No tests are configured today (see *Testing roadmap* below — debt, not a
position).

State today is hand-rolled module-level stores in `src/lib/*` consumed
through `useSyncExternalStore`. **No third-party state/query library.**
This is **implementation detail**, not an architectural ban.

- **Invariant:** the server is the source of truth for every domain in the
  *Data Ownership Map*. After any mutation, the affected store is invalidated
  and rehydrated from its canonical API. Cross-domain reads of finance /
  ownership / auth state go through API routes, never through the browser
  Supabase client.
- **Implementation:** module-level `subscribe + emit` per domain.
- **When to revisit:** consider a query/cache library (TanStack Query is the
  natural candidate) only when at least two of these are true: ≥3 stores need
  coordinated invalidation on a single mutation, request deduplication /
  background refetch becomes a real product need, or the hand-rolled
  subscribe boilerplate exceeds ~25 files. Migrate one domain at a time and
  keep the canonical-refresh contract identical. Do **not** preemptively
  swap libraries — the invariant above is library-agnostic.

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

#### Financial Calculation Ownership

This is a healthcare-finance platform. Money math is **server-side only**.

- Financial calculations MUST happen in SQL / RPC / API-route logic.
- The frontend MUST NOT calculate any of:
  - commissions
  - settlements
  - refunds
  - payouts
  - wallet balances
  - revenue / collected / refunded totals
  - platform net or "net after labs"
  - exchange-rate conversions for online charges
- The frontend renders **canonical values returned by the API**. If a
  number isn't in the response, the answer is "expose it server-side",
  never "compute it in React".
- Wallet balances are **ledger-derived**. They are written only as a
  side-effect of an RPC inserting a `*_wallet_transactions` row.
  Manual mutation of `nurse_wallets.balance` or `lab_wallets.balance` is
  forbidden — drift will fail the SQL invariant queries.
- Historical records are **append-only / immutable**:
  - `nurse_wallet_transactions`, `lab_wallet_transactions`, `payments`,
    `payment_provider_events`, `order_status_history`,
    `admin_activity_logs` are write-once. Don't UPDATE/DELETE them in
    application code; admin "corrections" go through `adjustment` /
    `cash_refund` / `refund` ledger types.
  - `lab_wallet_transactions.payout_snapshot` (per-item breakdown at
    accrual time) and `nurse_wallet_transactions.commission_rate_snapshot`
    must NOT be backfilled or rewritten when rates change later.

Examples:

```ts
// ❌ Don't do this — recomputing a balance in React.
const balance = txns.reduce((s, t) => s + (t.direction === "credit" ? t.amount : -t.amount), 0);

// ❌ Don't do this — inferring platform revenue from local order data.
const revenue = orders.reduce((s, o) => s + o.total, 0);

// ❌ Don't do this — converting SYP to USD in the cart.
const usd = totalSyp / 13000;

// ✅ Do this — read what the server returned.
const { netDue, totalCommission } = await fetch(`/api/nurses/${id}/wallet`).then(r => r.json());

// ✅ Do this — exchange rate comes from create-intent response.
const { chargedAmount, providerCurrency, exchangeRate } = await apiCreateStripeIntent(orderId);
```

#### Logic Ownership Taxonomy

A clean test for what belongs where:

**Server-authoritative (never on client) — invariant:**

- **Money math** — prices, totals, discounts, commissions, payouts,
  settlements, refunds, wallet balances, exchange-rate conversions.
- **Authorization** — who can see / do what. Client guards are UX hints;
  the route auth guard is truth.
- **Canonical state transitions** — order status, payment status, ledger
  writes.
- **Identity / uniqueness** — order numbers, idempotency keys, references.
- **Validation that protects an invariant** — coupon validity, booking-window
  enforcement, payment gate, catalog price snapshots at order creation.

**Client-acceptable — guideline:**

- **Interaction logic** — which sheet is open, which tab is active, wizard
  step, drag/scroll/focus.
- **Presentation logic** — formatting (`formatPrice`, `formatDate`),
  badge/color selection from canonical status, RTL/LTR handling,
  responsive layout.
- **Optimistic UX state** — provisional flips that show immediately and
  ideally roll back on API failure. Permitted *only* with a follow-up
  canonical refresh; forbidden as the final resting state for finance
  fields.
- **Transient form state** — drafts, validation hints, debouncing. Final
  validation is still server-side.
- **Pure projections of canonical data** — filtering, sorting, grouping,
  derived display flags.

**Litmus test.** "If two clients computed this independently and disagreed,
would it cost money, breach trust, or break an audit?" Yes → server.
No → client is fine.

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

## Freshness model — Realtime, polling, optimistic UI

The data freshness contract today is **API hydration + optimistic UI +
canonical refresh**. The rules below distinguish what is non-negotiable
from what is current implementation.

- **Invariant — financial truth.** State transitions on `payments`,
  `orders.payment_status`, `*_wallet_transactions`, and
  `payment_provider_events` are settled **only** by the server-side path
  that owns them (RPC + webhook for online, RPC for cash). Realtime,
  polling, optimistic UI, and client subscriptions are **read-side**
  mechanisms; none of them may flip authoritative state.
- **Invariant — canonical refresh after mutation.** Every mutator returns
  (or the `useOrderByIdempotencyKey` / `awaitOrderRemote` helpers wait
  for) the canonical row, which is merged into the store. Optimistic
  state without a follow-up canonical merge is forbidden for anything
  financial.
- **Constraint — polling for webhook-settled state.** When the source of
  truth is a webhook or a long-running RPC and the user is waiting for
  confirmation, polling is the right tool today. Example:
  `StripePaymentScreen` polls `/api/orders/[id]/payment-status` every 2s
  for up to ~60s. Admin OCC + Lab portal hydrate on mount and refresh on
  user action.
- **Implementation — `useSyncExternalStore` is a local-render
  optimization**, not a source of truth. Module-level stores in
  `src/lib/store.ts` and siblings cache the last canonical hydrate so
  re-renders don't refetch; the cache is invalidated on every mutator
  call.
- **Guideline — Supabase Realtime is permitted, but never authoritative.**
  Realtime is **not forbidden**. It is acceptable as a UX nudge for
  non-financial surfaces (admin OCC order list, nurse online-status
  board, lab portal new-orders, notifications inbox). If a Realtime
  subscription is added:
  1. The handler's only job is to call the canonical hydrator
     (`fetchOrdersForAdmin`, etc.). It does **not** patch local state
     from the event payload.
  2. The screen must remain correct without Realtime — i.e. a fallback
     poll or manual refresh still produces the same final state.
  3. Financial fields stay on polling-after-webhook, even on a
     Realtime-enabled screen.
  No Realtime subscriptions exist today; do not add them as part of
  routine work — they are a Phase 5.x+ enhancement.
- **Guideline — optimistic UI rollback.** Aim to capture the prior row and
  restore it if the API rejects, especially in finance-adjacent flows.
  Today, `persistOrderActionViaApi` in `src/lib/store.ts` merges the
  canonical row on success but does **not** auto-rollback on failure;
  the next hydrate corrects the view, but UI may briefly mislead. Treat
  this as known debt. In finance flows, render a "جاري التحقق…"
  surface during the gap rather than the success surface.
- **Guideline — eventual consistency is acceptable on non-financial
  reads.** A nurse seeing a 5-second-stale notification list is not a
  bug; an admin seeing a 5-second-stale wallet balance during a refund
  is.

## Data Ownership Map

Every domain has exactly one source of truth. When a screen needs a
number, the answer is "hydrate it from the canonical table via the
appropriate API"; never reconstruct it from a join in client code.

| Domain | Source of Truth | Notes |
|---|---|---|
| Orders | `orders` | Hydrated through `fetchOrdersForCustomer / ForNurse / ForAdmin / fetchOrderById` (`lib/supabase/queries/orders.ts`); never read directly from client code |
| Order items | `order_items` | Snapshot at order creation; price/name immutable post-create |
| Order status history | `order_status_history` | Append-only audit; written by every status RPC |
| Payments (per collection) | `payments` | Provider snapshot (`provider`, `provider_ref`, `charged_amount`, `provider_currency`, `exchange_rate`, `provider_metadata`) is authoritative for the online charge |
| Provider events | `payment_provider_events` | Stripe event idempotency log; webhook is the only writer |
| Nurse wallet | `nurse_wallets` (balance) + `nurse_wallet_transactions` (ledger) | Balance is ledger-derived. `commission_rate_snapshot` immutable |
| Lab wallet | `lab_wallets` + `lab_wallet_transactions` | `payout_snapshot` jsonb breakdown immutable |
| Lab payout rules | `lab_payout_rules` + `app_settings.lab_default_payout_*` | 3-tier resolver (`resolve_lab_payout` RPC) |
| Lab issues | `lab_issues` | Customer message editable; internal `description` private |
| Settlements (lab periodic) | `settlements` + `settlement_items` | Legacy lab settlement engine; coexists with the new ledger |
| Notifications | `notifications` | Customer + nurse + admin recipients; `recipient_id = profiles.id` |
| Admin activity log | `admin_activity_logs` | Append-only operational audit |
| Customer profile | `customers` (joined with `profiles`) | Auth-bound; soft-deleted via `deleted_at` |
| Patients | `patients` | Per-customer; soft-deleted via `deleted_at` |
| Addresses | `addresses` | Per-customer; soft-deleted via `deleted_at` |
| Catalog tests | `lab_tests` + `test_categories` + `instruction_library` + `lab_test_instructions` | Admin-managed |
| Catalog packages | `packages` + `package_items` | Admin-managed |
| Coupons | `coupons` | Server-validated only via `/api/coupons/validate` |
| Sliders | `home_sliders` | Admin-managed |
| Nurse prep state | `nurse_prep_state` | Daily persisted state per nurse |
| Nurse shortage requests | `nurse_shortage_requests` (+ `_items`) | Field-to-admin signal |
| Nurse gamification | `nurse_gamification` | Read-only to nurse; admin can adjust |
| Lab result files | `lab_result_files` (+ `_events`) | Files in private bucket; signed URLs minted server-side |
| Branding | `app_branding` (singleton) | Admin-editable |
| App settings | `app_settings` (singleton, `id=1` invariant) | Includes Stripe config + payout defaults + commission percentage |
| Content pages | `content_pages` | Terms / privacy / support / faq |

### Composition rule

- **Invariant — server-owned composition.** Any value that participates in
  audit, finance, or trust must be composed server-side and returned
  canonically: order totals, commissions, refund amounts, settlement
  positions, lab payout snapshots, wallet balances, "net after labs",
  revenue / collected / refunded summaries, and any cross-table aggregate
  read as a number by an admin or auditor. Expose via RPC or server view.
- **Guideline — client composition is allowed for presentation.**
  Filtering, sorting, grouping rows the API already returned; pairing a
  `patient.name` with an `order.patientId` from already-hydrated lists;
  deriving display state (`isOverdue`, `statusColor`) from canonical
  fields. These are projections of server truth, not aggregations of it.
  Don't proliferate one-off RPCs for purely presentational joins.
- **Litmus test:** if the wrong number could mislead a customer about
  money, an admin in a reconciliation, or an auditor in a dispute →
  server. If it only affects how something *looks* and is recomputable
  from already-hydrated canonical fields → client is fine.

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

**Customer app composition (implementation, not policy).** The customer app
is a single client component (`src/app/page.tsx`) that switches views via
local state. This is the current shape, chosen because the booking wizard
is a single transaction and nested routes would over-complicate the mobile
back-button. **Mobile-first, RTL is invariant** — whether achieved with one
component or twenty is a refactoring question, not an architectural one.

Introduce real routes when *any* of: a view should be deep-linkable
(specific package, shared cart, marketing/SEO surface), a view carries a
heavy bundle the rest of the app shouldn't pay for, or `page.tsx` grows
state that doesn't belong to the booking transaction. No restructuring is
needed today.

**`AdminDashboard.tsx` (guideline, not policy).** Co-locating state and
sub-components is fine while they share lifecycle and mutate together —
locality of change beats file-count tidiness. The file is large today
(~3.6k lines); that is acceptable but no longer purely beneficial.

Split a subtree when *any* of these is true:

- It has a meaningfully independent lifecycle (e.g. a finance subtab loaded
  only by `finance_admin`) — split and consider lazy-loading it.
- It belongs to a different role boundary in `ROLE_PERMISSIONS` — splitting
  clarifies the auth boundary at the file level.
- The shared mutable state at the top is no longer touched by the subtree.
- Review/merge friction is dominated by the file (frequent simultaneous
  edits, conflicts).
- Type-checking or HMR latency is materially affected.

Don't split for: pure aesthetics, "clean architecture", or arbitrary
line-count rules. Finance subtabs are the natural first extraction when
they grow further; treat that as expected refactoring, not "blowing it
apart."

**`OrderControlCenter.tsx` (decomposed as of U4.A–E).** OCC was
originally a single ~3.6k-line file mixing dispatcher shell, sticky
header, six tab bodies, and shared sheet helpers. It is now split into
sibling files in `src/components/admin/`:

- `OrderControlCenter.tsx` — dispatcher shell, `OverviewTab`,
  `ItemsTab`, `Stars`, `RatingCard`, local `Card`/`Row`, the
  `ControlCenterRole` type-only export, and the tab/role matrix
  (`tabsFor`, `TAB_META`, `TABS_BY_ROLE`).
- `OCCStickyHeader.tsx` — sticky header + the 5 sheet states +
  `ReasonSheet` / `DateSheet` / `StatusPickerSheet` / `CouponSheet` +
  `ActionItem` / `Pill` / `record` / `hasCap` (helpers private to
  this file because StickyHeader is their only consumer).
- `OCCOperationsTab.tsx`, `OCCFinanceTab.tsx`, `OCCIssuesTab.tsx`,
  `OCCTimelineTab.tsx`, `OCCNotesTab.tsx` — one tab per file. Each
  child owns its own state and locally-duplicated helpers
  (`Card`/`Row`/`Pill`/`ReasonSheet`/`canEditPricing`/`hasCap`).

The locally-duplicated helpers are intentional — see
"extraction-before-abstraction" in *AI Agent Rules* below. **U4.F.1**
(landed) consolidated `hasCap`, `Card`, `ReasonSheet`, and the
`OrderActorRef` type into `src/components/admin/occ-helpers.tsx`. The
remaining single-use helpers (`record`, `ActionItem`, `DateSheet`,
`StatusPickerSheet`, `CouponSheet`, `Stars`, `RatingCard`,
`EVENT_LABELS`, `canEditPricing`) stay co-located with their sole
consumer by design.

**OCC drift — intentionally preserved (U4.F audit findings).** Two
helpers diverged across the OCC family during U4.A–E:

- **`Row`** — parent `OverviewTab` uses `gap-3 text-xs` with
  `font-medium break-words` on the value; tab bodies
  (`OCCOperationsTab`, `OCCFinanceTab`) use `gap-2 py-1` with
  `text-[11px] text-gray-400` label and `text-xs text-[#164E63]`
  value. They render at noticeably different densities.
- **`Pill`** — `OCCStickyHeader`'s payment-status pills are
  `text-[11px] font-semibold` with `bg-red-50 text-red-600` for the
  red palette; `OCCIssuesTab`'s status pills are `text-[10px]
  font-bold` with `bg-rose-50 text-rose-700`. They render at different
  sizes and weights.

These are no longer code duplication — they are divergent visual
semantics. Unifying either would force a UX/styling decision and
violate the "no styling drift" rule of structural refactors. They are
**deferred to a future visual-consistency design pass**, not
considered architectural debt. If you find yourself "tidying up" by
picking one Row or one Pill as canonical, stop — that is U4.F.2 (or
later), not U4.F.1.

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

## Deployment Assumptions

The platform's deployment shape — current and intended:

- **Frontend**: Vercel, Next.js 16 App Router. Server routes run on
  Vercel's serverless runtime (`runtime = "nodejs"` for routes that
  need the Stripe webhook signature verifier).
- **Backend**: Supabase (managed Postgres + Auth + Storage). Service
  role calls from API routes; RLS enabled on every customer-facing
  table; service-role bypasses RLS by design and is only reachable
  via `lib/supabase/server-admin.ts` (`server-only`).
- **Storage**: Supabase Storage, all buckets **private**. Signed URLs
  minted server-side at hydrate time (TTL ~1h) — `lab-results`,
  `prescriptions`, `media-library`.
- **Region**: single-region today is acceptable. Cross-region read
  replicas are not in scope.
- **Rate limiting**: in-memory token bucket
  (`src/lib/api/rate-limit.ts`). This is **single-instance only**.
  Before scaling beyond one Vercel region or function instance, swap
  the backing Map for Upstash Redis or Vercel KV. The call surface is
  shaped to make that swap a single-file change.
- **Stripe webhook**: requires a stable public HTTPS endpoint at
  `/api/webhooks/stripe`. The route is `runtime = "nodejs"` and uses
  `req.text()` to preserve the raw body for signature verification.
- **Environment separation**: local / staging / production must be
  fully isolated — separate Supabase projects, separate Stripe keys
  (test → staging, live → production), separate `STRIPE_WEBHOOK_SECRET`
  per environment. Never share keys across environments.

Production hard rules:

- **Production must NEVER expose demo credentials.** The boot guard in
  `src/lib/demo-credentials.ts` throws if `NEXT_PUBLIC_SHOW_DEMO_CREDS`
  is `"true"` while `NODE_ENV=production`. Don't disable that guard.
- **Production must NEVER return verbose DB errors.** All high-risk
  routes funnel errors through `safeApiError` (`src/lib/api/safe-error.ts`)
  which logs the raw error server-side and returns generic Arabic copy.
  Don't `return NextResponse.json({ error: error.message }, …)` from
  any route that touches money, auth, or PII.
- **Production must NEVER enable `NEXT_PUBLIC_USE_SUPABASE_DEV_OTP`.**
  The bypass is gated by `NODE_ENV !== "production"` in
  `src/lib/supabase/flags.ts`; keep that guard.

## Observability Standards

The audit trail is the product. Every financial mutation has to be
reconstructible from logs + ledger.

- **Every critical finance mutation must log** (server-side via
  `logger`):
  - `route` (e.g. `api/orders/cash-collected`)
  - `orderId` and/or `paymentId` when applicable
  - actor `role` and `userId`
  - the txn `type` if a ledger row was written
  - timestamp (logger appends `ts` automatically)
- **Logger redacts** (already implemented in `src/lib/logger.ts`):
  - `authorization` / `cookie` / `set-cookie` headers
  - any key named `password` / `token` / `access_token` /
    `refresh_token` / `id_token` / `client_secret` / `stripe-signature`
    / `stripe_secret_key` / `secret` / `api_key` / `apikey`
  - any string matching `^Bearer\s+`, `^sk_(live|test)_`, `^whsec_`
- **All P0 / P1 errors must**:
  - log server-side with full context (sanitized)
  - return a safe Arabic error to the client via `safeApiError`
  - never echo raw `error.message`, constraint names, or RLS hints
- **Sentry forwarding is opt-in** via `SENTRY_DSN`. The dynamic import
  in `lib/logger.ts` keeps `@sentry/nextjs` out of the bundle when
  unused. If we wire Sentry in production, it must:
  - preserve a correlation id per request (route + nearest UUID such as
    `orderId` / `paymentId`)
  - group by `route` + error class so finance and webhook errors don't
    drown in customer 4xx noise
  - never receive raw payloads — the same redaction rules apply
- **Webhook forensics**: every Stripe delivery is recorded in
  `payment_provider_events` with a `result` tag (`received |
  confirmed | failed | refunded | ignored | no_match | duplicate |
  confirm_error | failed_error | refund_error`). The `*_error` tags
  are retryable and tell ops "Stripe will deliver again". Don't
  invent new tags without updating the webhook handler's terminal vs
  retryable sets.

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

## AI Agent Rules

If you are an AI assistant editing this codebase, the following rules
apply on top of everything above. They exist because most regressions
in a system like this come from an agent taking a "convenient" shortcut.

- **Don't bypass RPCs.** State changes go through SECURITY DEFINER
  functions in `supabase/migrations/*`. If the change you need isn't
  expressible by an existing RPC, write a new RPC and call it from a
  route — don't reach into tables directly from a route handler when
  an RPC owns that domain.
- **Don't introduce parallel business logic paths.** If `cancel_order_admin`
  already handles "this order was paid → reverse the cash" on the
  server, don't add a second cancel path that does it client-side or
  in a different RPC. One canonical path per domain.
- **Don't add direct table writes from client code.** The browser must
  not import `getSupabaseAdmin` (the `server-only` guard will throw at
  build time if you try) and must not call `.insert()` / `.update()`
  / `.delete()` on any business table. Even reads of finance,
  payments, or wallet tables go through API routes, not the
  authenticated browser client.
- **Don't add client-side financial math.** See the
  "Financial Calculation Ownership" subsection. Numbers come from the
  API; the UI renders them.
- **Don't weaken auth guards for convenience.** Every route uses one
  of `requireAuthedUser` / `requireAdmin` /
  `requireCustomerSelfOrAdmin` / `requireNurseSelfOrAdmin` and
  re-checks resource ownership for any URL-scoped id. Don't downgrade
  `requireAdmin` to `requireAuthedUser`. Don't remove the
  `lab_id === auth.session.labId` check on lab confirm. Don't return
  data the session shouldn't see.
- **Don't introduce mock fallback behavior into production paths.** The
  legacy `USE_SUPABASE` flag still exists in `src/lib/supabase/flags.ts`
  and is read in a handful of stores (`tool-library.ts`,
  `instruction-library.ts`, `nurse-gamification.ts`, `home-sliders.ts`,
  `BookingFlow.tsx`, `NurseApp.tsx`, `store.ts`). It is set via
  `NEXT_PUBLIC_USE_SUPABASE=true` and **must be `true` in every deployed
  environment** — when false, mutators silently no-op the remote write.
  Treat the remaining `if (!USE_SUPABASE)` branches as dead code on the
  remove-list, not as legitimate fallbacks. `src/lib/mock-data.ts` is
  retained but only as a constants/labels module
  (`ORDER_STATUS_LABELS`, `FAILED_COLLECTION_REASONS`,
  `LAB_ISSUE_REASONS`, `COMMON_INSTRUCTIONS`, `SYSTEM_SETTINGS`
  defaults, level tables for gamification). Don't bring back "if the
  API fails, render mock values" — finance especially must show empty
  states + an error, never a fake number.
- **Prefer extending existing flows over creating new duplicated
  abstractions.** The store mutators, API helpers, and route guards
  already cover ~95% of the contract you need. New mutators should
  extend `lib/store.ts`; new admin views should extend
  `FinanceAdmin.tsx` rather than spawn a parallel page.
- **Don't relax migration ordering invariants.** Migrations are
  numbered + idempotent (`if not exists`, `add value if not exists`).
  Don't edit a previously-applied migration in place; add a new
  numbered one that supersedes the prior behavior.
- **Don't add a new `result` tag to `payment_provider_events`** without
  updating both the webhook handler's `TERMINAL_RESULTS` and
  `RETRYABLE_RESULTS` sets and migration 035's column comment.
- **Extraction before abstraction.** When breaking a large component
  into siblings, locally duplicate small presentational helpers
  (`Card`, `Row`, `Pill`, `ReasonSheet` shape, `hasCap`) in each
  extracted child rather than promoting them to a shared module
  up-front. Shared modules force you to commit to an abstraction
  before all consumers exist; duplicates make it cheap to discover
  what the right shared shape actually is, and let each phase land
  with a small, reviewable diff. Once every consumer has been
  extracted, a dedicated cleanup phase (e.g. **U4.F** for OCC) decides
  which duplicates are real duplicates worth promoting. The OCC
  decomposition (U4.A–E) followed this rule. Do not "tidy up" by
  introducing a shared helper in the middle of an extraction series.

## Known minor risks (deliberately accepted)

These are documented so a future agent does not "discover" them and
silently change behavior. They were reviewed and considered low-severity
or below the change-cost threshold for soft-launch.

- **`/api/system/settings` exposes `nurse_commission_percentage`
  publicly.** Every portal (including unauthenticated guests on `/`)
  hits this route on mount. The commission rate is operational
  intelligence, not customer PII or transaction data; gating it would
  require either making the route auth-aware (touches its caching
  contract) or splitting the field to an admin-only GET (touches
  AdminDashboard hydration). For soft-launch we accept the leak; if
  competitive sensitivity grows, expose the field only on
  `/api/admin/system/settings` GET and read it from the admin store
  separately.
- **Optimistic UI rollback is partial.** `collectCash` and
  `recordAdminCashPayment` snapshot and restore on failure (added in
  Phase 5.1 hardening). Other mutators in `store.ts`
  (`cancelOrder`, `setPaymentStatus`, `addNote`, etc.) still rely on
  the next canonical hydrate to correct the UI on persist failure.
  This is bounded — the next refresh fixes it — but a finance flow
  that depends on a non-cash mutator should add a snapshot/restore
  pair before launch.
- **Coupon-validation logic is duplicated** between
  `/api/coupons/validate` (read-only preview) and the recompute paths
  inside `/api/orders` POST and `/api/admin/orders` POST. The two
  copies are line-for-line identical today. Extracting to a shared
  helper is a low-risk cleanup but not load-bearing — the
  authoritative computation is whichever runs at order placement.
- **Admin OCC payment-status changes use `window.prompt`** for
  pending/failed/refunded transitions (`OrderControlCenter.tsx`).
  Constrained to non-`paid` values and admin-only; UX debt rather
  than a security issue.

## Recovery & reconciliation roadmap

**Consistency model.** Authoritative writes are strongly consistent
within a single RPC transaction. Across the order ↔ payment ↔ ledger
boundary, the system is **eventually consistent through Stripe webhook
replay and idempotent RPCs**. Every consumer of finance state must
tolerate a brief gap between user action and ledger settlement.

**In place today:**

- Stripe replays failed webhook deliveries; `*_error` result tags in
  `payment_provider_events` mark events as retryable.
- Partial unique indexes prevent double-credit on replay.
- `payment_provider_events.id` is the dedup key.
- Customer payment screen polls until the webhook settles.

**Operational gaps — TODO post-launch operational hardening, not launch
blockers.** Each item below is explicitly deferred:

- **TODO (post-launch): refund clawback.** A refund of a completed order
  today does NOT reverse its accrued nurse commission or lab earning.
  Until automated `commission_clawback` / `earning_clawback` ledger
  types ship (Phase 5.x), Admin Finance should surface a "pending
  clawback" badge on refunded-but-completed orders so ops can issue a
  manual `adjustment` row. *Not a launch blocker* unless your day-1
  refund volume is non-trivial.
- **TODO (post-launch): orphan-payment sweeper.** A scheduled job
  (Supabase cron / Vercel cron) that finds `payments` rows stuck in
  `pending` with no terminal `payment_provider_events` after N hours,
  marks them expired, and surfaces them to admin. Until it ships,
  orphan rows accumulate but are non-load-bearing — the order itself
  blocks on `payment_status='paid'` so nothing operationally drifts.
  *Not a launch blocker.*
- **TODO (post-launch): Stripe reconciliation job.** Nightly diff of
  `payments` (online, paid-ish, last 24h) against the Stripe
  `PaymentIntents` API; surface divergence to ops without
  auto-correcting. Until it ships, divergence is detected by support
  reports, not proactively. *Not a launch blocker.*
- **TODO (post-launch): webhook replay runbook.** A documented
  procedure for ops to re-deliver a Stripe event from the dashboard
  with the expectation that the system will dedupe. The code already
  supports this via `payment_provider_events.id` + the `*_error`
  retryable tags; the gap is human-facing documentation. *Not a
  launch blocker.*
- **TODO (post-launch): settlement batch atomicity.** Settlements that
  touch multiple wallets in one batch must be transactional or
  explicitly resumable. Behavior today is documented here so future
  agents do not assume a cleaner contract than exists. *Not a launch
  blocker.*

Build these as part of post-launch operational hardening; do not block
v1 / soft-launch on them unless an active production incident demands
it. Bulk recalculation, mass notifications, and periodic reconciliation
will eventually move to a queue (Inngest / Vercel Queues / Supabase
scheduled functions); none of that is required for today's scope, and
queues do not change the consistency model — they execute the same
idempotent RPCs.

## Future Scaling Considerations

These are likely upgrades when the platform grows. They are **not
current blockers** — flagging them so future agents know what's
deliberate vs deferred.

- **Distributed rate limiting**: replace the in-memory bucket in
  `lib/api/rate-limit.ts` with Upstash Redis / Vercel KV. The call
  surface is already shaped for the swap.
- **Background jobs / queues**: long-running work (e.g. mass
  notifications, periodic settlement generation, bulk lab earning
  recalculation if rules change retroactively) belongs on a queue,
  not inside a serverless route. Likely candidates: Inngest, Vercel
  Queues, Supabase Edge Functions cron.
- **Realtime subscriptions**: Supabase Realtime channels for the OCC
  + nurse home + lab portal would replace polling for non-financial
  surfaces. Financial surfaces stay on polling-after-canonical-API
  even if Realtime ships.
- **Sentry full integration**: DSN + correlation id middleware +
  per-route grouping. The logger is already wired for the dynamic
  import.
- **Ledger immutability enforcement at the DB**:
  `BEFORE UPDATE OR DELETE` triggers on `nurse_wallet_transactions`,
  `lab_wallet_transactions`, `payments`, `payment_provider_events`,
  `order_status_history` raising unless a session GUC
  `app.allow_ledger_mutation = 'on'` is set.
- **Refund clawback automation**: a refund of a previously-completed
  order today does NOT reverse its commission or lab earning. Phase
  5.x will add `commission_clawback` / `earning_clawback` types and
  wire them into `record_provider_refund` + `refund_payment_admin`.
- **Analytics / BI warehouse**: nightly export of orders, payments,
  ledger, and provider events to a warehouse. Heavy BI queries should
  not hit the OLTP database.
- **Audit history for payout-rule edits**: `lab_payout_rules` is
  mutable today. Add `lab_payout_rules_history` so retroactive rule
  changes have a paper trail.
- **Multi-region / read replicas**: not on the roadmap, but if it
  lands, the Stripe webhook must continue routing to a single writer
  region — the partial unique index on
  `payment_provider_events(id)` is the source of truth for
  idempotency and cannot tolerate split brain.

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

## Testing roadmap

**Today:** no automated tests are configured. The 17-step manual QA
checklist below is the safety net. This is **debt to be paid down**, not
an architectural position.

**Priority order when test infra is added** (do not adopt all at once):

1. **DB-level invariants.** pgTAP or SQL fixtures over the migrations:
   idempotency partial unique indexes hold; `accrue_nurse_commission` /
   `accrue_lab_earning` are no-ops on unpaid orders; strict payment gate
   refuses unpaid `sample_collected+`; wallet balance always equals
   ledger sum; `payment_provider_events` keyed-on-event-id rejects
   duplicates.
2. **Webhook handler.** Signature verification, replay/duplicate
   handling, every `result` tag (`received | confirmed | … | duplicate
   | confirm_error`), terminal vs retryable transitions, partial-refund
   and refund-after-full paths.
3. **Payout resolution.** `resolve_lab_payout` 3-tier resolver across
   fixtures: test-specific → lab-default → `app_settings` default.
   Lock the `payout_snapshot` shape — it is immutable history.
4. **API route auth guards.** Wrong-portal session → 403. Customer A
   reading customer B's order → 403. Lab A confirming Lab B's order →
   403. Force-complete refusing unpaid by default; succeeding with
   `allowUnpaid:true` without accrual.
5. **RPC contract tests.** `place_order_admin`, `set_order_status_admin`,
   `cash_collected`, `record_provider_*`, `cancel_order_admin`,
   `refund_payment_admin` — input shape, output shape, idempotency.
6. **Critical UI flows (E2E, Playwright).** Customer cash flow; customer
   online flow including webhook polling; nurse cash collection; lab
   confirm with auto-complete; admin refund.
7. **Component tests** are the lowest priority and should not be the
   first investment.

The 17-step manual checklist below stays as a release smoke test; each
automated layer above retires the corresponding manual step.

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
