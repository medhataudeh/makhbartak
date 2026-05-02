@AGENTS.md

> **Read AGENTS.md first.** This Next.js version has breaking changes from your
> training data. Before writing Next-specific code (routing, layouts, fonts,
> images, server/client boundaries), open `node_modules/next/dist/docs/` and
> verify the current API. Do not trust your priors.

---

# مختبرك (makhbartak)

## Project overview

At-home lab test ordering for Damascus and Rural Damascus. A patient picks a
ready-made package, uploads a doctor's prescription, or builds a custom test
set; a nurse visits, collects samples; the lab uploads a PDF; the result lands
in the patient's phone. The app must feel as easy as ordering a ride and as
trustworthy as a clinic.

This repo is currently a **mock prototype**: the source of truth for every
flow is in-memory state and `localStorage`, seeded from `src/lib/mock-data.ts`.
Authentication, orders, results, payments, and prescription OCR are all
simulated. Treat the codebase as a high-fidelity, clickable contract that
designers, stakeholders, and back-end engineers work against.

A Supabase schema (`supabase/migrations/*`) and partial query/RPC layer
(`src/lib/supabase/`) exist but are **staged, not authoritative**. Wiring is
gated on `NEXT_PUBLIC_USE_SUPABASE=true`; even when on, current calls are
fire-and-forget and the in-memory state always wins. Real persistence (auth
bridge, order RPCs, RLS) is intentionally out of scope this phase. See
`### Persistence layer` below for the full mock-vs-Supabase map.

For deeper product/design context: `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`.

## Product context

- Single product, four apps in one repo (see "App scope" below).
- Arabic-first, RTL, mobile-first. Desktop layouts exist for staff portals
  (admin, lab); customer + nurse are phone-shaped even on desktop.
- Brand: **Reliable · Clinical · Human.** Closer to Careem's operational
  clarity + Vezeeta's medical trust, but simpler — built for users who may
  distrust complex interfaces. Avoid e-commerce, government, and
  luxury-healthcare aesthetics (see PRODUCT.md anti-references).

## Target users

- **Patients & family members** in Damascus / Rural Damascus, age 25–60,
  ordering for themselves or a relative. Mixed mobile literacy — assume the
  user has never opened the app before. Prefer icons + short labels over
  paragraphs.
- **Nurses** doing home visits — phone-shaped, glanceable, gamified.
- **Lab technicians** — desktop, list + detail, upload PDFs to orders.
- **Admins** — desktop dashboard with role-based access (6 roles).

## Tech stack

| | |
|---|---|
| Framework | Next.js **16.2.4** (App Router) — APIs may differ from training data |
| Runtime | React **19.2.4** |
| Language | TypeScript **strict** (`@/*` → `./src/*`) |
| Styling | Tailwind CSS **v4** (PostCSS plugin) + `tailwind.config.ts` for tokens |
| Animation | framer-motion **12** |
| Icons | lucide-react **1.x** (note: very early major — verify icon names exist) |
| Primitives | @radix-ui/react-dialog, @radix-ui/react-slot |
| Utilities | clsx, tailwind-merge (use `cn()` from `@/lib/utils`) |
| Variants | class-variance-authority |
| Font | Readex Pro (next/font/google) — Arabic + Latin |
| Package manager | **npm** (package-lock.json committed) |

No tests are configured. No state library (plain `useState` + prop drilling).
No data fetching layer (mock arrays imported directly).

## Project structure

```
src/
  app/
    layout.tsx           # RTL <html lang="ar" dir="rtl">, Readex Pro, theme color
    page.tsx             # Customer app (auth + tabbed shell)
    globals.css          # Tailwind import + .lat utility + reduced-motion + safe areas
    admin/page.tsx       # Admin (login + dashboard, localStorage session)
    nurse/page.tsx       # Nurse app
    lab/page.tsx         # Lab portal
  components/
    ui/                  # Button, BottomSheet, FullScreenModal, Card, Badge,
                         # StatusBadge, Input, Skeleton, BackButton
    layout/              # BottomNav (mobile), SideNav (desktop)
    auth/                # LoginForm + per-portal login wrappers (CustomerLogin, NurseLogin)
    home/                # HomeScreen, HomeSlider, CustomTestBuilder, PrescriptionUploader
    booking/             # BookingFlow (shift + address + patient)
    cart/                # CartScreen (coupon, payment method, confirm)
    order/               # OrdersList, OrderDetails, OrderSuccess, InstructionIcons
    notifications/       # NotificationsScreen
    account/             # AccountScreen
    nurse/               # NurseApp (single big component)
    lab/                 # LabPortal
    admin/               # AdminDashboard (single ~2k LOC), AdminLogin, InvoiceView
  lib/
    types.ts             # All TS interfaces, role permissions, status unions
    mock-data.ts         # All seed data + helpers (validateCoupon, getShiftConfigs, etc.)
    utils.ts             # cn, formatPrice, formatDate, searchTests, relativeTime
public/                  # static assets, manifest
```

Notes:
- The customer app is a **single client component** (`src/app/page.tsx`) that
  switches views via local state — no nested routes for the booking flow.
- `AdminDashboard` is intentionally one large file with internal sub-components
  and centralized state. Don't blow it apart "for hygiene"; do split when a
  section grows new responsibilities.

## Important commands

```bash
npm run dev      # next dev — http://localhost:3000
npm run build    # next build — must pass before declaring a task done
npm run lint     # eslint (next/core-web-vitals + next/typescript)
npm start        # serve a built app
```

Routes: `/` (customer), `/admin`, `/nurse`, `/lab`. All four gate behind
`useSession()` from `lib/auth.ts` and render their portal's `LoginForm`
when there is no matching role session.

## Design principles

From `PRODUCT.md` — these are non-negotiable:

1. **Clarity over cleverness.** If a label, icon, or animation doesn't reduce
   cognitive load, remove it.
2. **One clear action per screen.** Each view has one dominant CTA; secondary
   actions are quieter or live in a sheet.
3. **Trust through restraint.** Clinical credibility comes from spacing and
   typography, not "medical" stock icons or busy gradients.
4. **Sheets over pages.** Bottom sheet for quick choices; full-screen modal
   for complex inputs. Avoid pushing a new page when a sheet would do.
5. **Human feedback at every step.** Loading, success, and error states are
   warm and specific — never a bare spinner or "Error occurred."

Color rules (full table in `DESIGN.md`):
- Primary cyan `#0891B2` for links, active states, top-bar accent.
- CTA emerald `#059669` for primary action buttons and the cart badge.
- Cyan accent stays at **≤10% screen coverage** outside the hero.
- One subtle gradient permitted on the hero surface; nowhere else.
- No heavy box shadows. Cards = `border-gray-100`, no shadow.

Type rules:
- Single family: **Readex Pro**, weights 200–700.
- Minimum on-screen size: **11px**. Body: 14–16px. Page titles: 20–21px / 700.
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
  - `input[type="tel"]` and `input[type="number"]` are forced `direction: ltr`
    in `globals.css` — do not re-style.
  - Format prices with `formatPrice()` from `@/lib/utils` → `"59 ل.س"` via
    `toLocaleString("ar-SY")`.
- All primary copy (labels, CTAs, errors, empty states) is Arabic. English
  abbreviations (CBC, TSH, HbA1c) appear in `.lat` spans, smaller and lighter.
- Dates: `formatDate()` / `formatTime()` use `ar-SY` locale; relative times
  use Arabic words ("منذ X دقيقة"). Don't roll your own.

## Component conventions

- **Always prefer existing primitives** in `components/ui/`:
  `Button`, `BottomSheet`, `FullScreenModal`, `Card`, `Badge`, `StatusBadge`,
  `Input`, `Skeleton`, `BackButton`. Don't reinvent these.
- **`Button`** variants: `primary` (emerald), `secondary` (cyan), `outline`,
  `ghost`, `danger`. Sizes: `sm` h-9, `md` h-12, `lg` h-14. Always pass
  explicit `type` and rely on its built-in `aria-busy` while loading.
- **`BottomSheet`**: spring slide-up (damping 32 / stiffness 320), drag handle
  + drag-to-dismiss past 80px, `bg-black/50` backdrop (no blur — perf), max
  height 75vh. Already includes safe-area padding.
- **`StatusBadge`** + `ORDER_STATUS_LABELS` (in `mock-data.ts`) own all order
  status copy and color. Don't hard-code status strings.
- **Icons**: `lucide-react` only. SVG inline is acceptable for one-offs
  (see `BookingFlow` shift icons). **Never use emoji** in UI.
- **Class merging**: always use `cn(...)` from `@/lib/utils` (clsx +
  tailwind-merge) so later classes win cleanly.
- **Touch targets**: minimum 44×44px (`min-h-[44px] min-w-[44px]` or `h-12+`).
- **Borders + radius**: cards `rounded-xl border-gray-100`; inputs
  `rounded-xl`; buttons `rounded-xl` (sm) / `rounded-2xl` (md+); pills
  `rounded-full`; sheets `rounded-t-2xl`.
- **Client/server boundaries**: most files are `"use client"` because of
  framer-motion + state. Only mark a file `"use client"` when it actually
  needs hooks, browser APIs, or motion. Read the current Next docs in
  `node_modules/next/dist/docs/` before introducing server components or
  server actions — the API may have shifted.

## Motion / animation rules

- Animate **transform and opacity only**. No `width`/`height`/`top`/`left`
  animation. Layout-affecting properties cause jank.
- Easing: `easeOut` for entrances, `easeIn` for exits. Use spring physics for
  sheets and tap interactions.
- Standard durations:
  - Content fade-in: 220–250ms easeOut
  - Bottom sheet: spring damping 32 / stiffness 320
  - Full-screen push/pop: spring damping 30 / stiffness 300
  - Button tap: 100ms, scale to 0.97
  - Skeleton shimmer: 1.5s loop (already in `globals.css`)
- `prefers-reduced-motion` is honored globally by the CSS in `globals.css` —
  do not duplicate that handling. If you add a critical motion, make sure it
  degrades to a static state when motion is reduced.
- **No tab-switch animations** in the customer shell — bottom-nav swaps are
  instant (see `src/app/page.tsx`). Only push-style flows (booking → cart →
  success) animate.

## Business rules

These live in mock data + helpers; don't hard-code copies.

- **Visit shifts**: morning **8:00–10:00**, evening **16:00–18:00**.
  Configurable via `SYSTEM_SETTINGS` in `mock-data.ts`.
- **Minimum booking notice**: 120 minutes. Enforced by `getShiftConfigs()` —
  it returns `available: false` with an Arabic reason for shifts inside the
  notice window. Always render that reason; never silently disable.
- **Booking window**: customers may pick today plus
  `SystemSettings.bookingWindowDays` additional days (default 2 → today,
  tomorrow, day after). **Booking window is enforced in both UI and
  business logic.** UI alone is not sufficient:
  - UI: `BookingFlow`'s `<DateGrid>` renders **only** `bookingWindowDays + 1`
    cells starting today — no out-of-window dates appear, even disabled.
  - Logic: `getShiftConfigs()` marks every shift unavailable for any date
    past the window or in the past, with the standard Arabic reason. The
    `submit()` handler in `BookingFlow` re-checks `available` before
    forwarding so a bypassed UI cannot push an invalid date through.
  - Admin changes to `bookingWindowDays` propagate to live customer
    sessions in the same tab via `useSystemSettings()` (no refresh needed).
- **Supported cities**: دمشق, ريف دمشق.
- **Currency**: Syrian Pound (ل.س). Format with `formatPrice()`.
- **Coupons**: validated by `validateCoupon(code, total)` — covers active
  flag, date window, usage limit, min order, max discount cap. Use it; don't
  re-implement.
- **Order status flow** (defined in `OrderStatus` union):
  `created → priced → scheduled → confirmed → nurse_assigned → on_the_way →
  arrived → sample_collected → sent_to_lab → lab_processing → result_ready →
  completed`. Failure forks: `failed_to_collect`, `lab_issue`, `cancelled`.
  Reasons live in `FAILED_COLLECTION_REASONS` and `LAB_ISSUE_REASONS`.
- **Result files belong to the order, not the test.** A lab can upload many
  PDFs per order via `OrderResultFile`. There is no per-test PDF concept —
  don't add one. `Order.resultPdfUrl` is `@deprecated`; new code reads
  `Order.resultFiles`.
- **Patients/Addresses are per-user** and live inside the user profile
  drawer in admin — they are intentionally NOT standalone admin pages.
- **Invoice generation**: `generateInvoice(order, sequence)` produces an
  invoice on order confirmation. Numbers follow `INV-YYYY-####`.

## App scope

### Customer (`/` — `src/app/page.tsx`)
- Tabs: home, orders, notifications, account.
- Three entry paths to a booking: pick a Package, upload a Prescription,
  build a Custom test set.
- Flow: Home → (entry path) → BookingFlow (shift, address, patient) →
  CartScreen (coupon, payment) → OrderSuccess.
- Mobile-shaped on every viewport: main column is `max-w-md md:max-w-none`
  inside a centered container; desktop adds a `SideNav`.

### Nurse (`/nurse` — `components/nurse/NurseApp.tsx`)
- Phone-shaped on every viewport.
- Tabs: home (today's route + start-day prep checklist), schedule (next
  days), settings.
- Gamification: levels, badges, points, streaks (see `NURSE_LEVELS`,
  `NURSE_BADGES`, `GAMIFICATION_CONFIG`).
- Day starts when the nurse confirms the **prep checklist** (built from
  today's tests via `buildPrepChecklist`). Persisted per day in
  `localStorage` keys `makhbartak.nurse.prep:<date>` and
  `makhbartak.nurse.started:<date>`.
- Nurse notifications are a **separate inbox** (`MOCK_NURSE_NOTIFICATIONS`),
  not the customer one.

### Lab (`/lab` — `components/lab/LabPortal.tsx`)
- Desktop/tablet two-pane: order list + selected order detail.
- Filter by status; show only orders in lab-relevant statuses
  (`sample_collected`, `sent_to_lab`, `lab_processing`, `result_ready`,
  `completed`).
- Per-order: upload one or many PDFs, delete/replace, mark ready, or report
  a lab issue with a reason from `LAB_ISSUE_REASONS`.

### Admin (`/admin` — `components/admin/AdminDashboard.tsx`)
- Login via mock credentials in `MOCK_ADMINS`. Session in `localStorage`
  under `makhbartak.admin.session`.
- Six roles, gated by `ROLE_PERMISSIONS` + `canAccess(role, section)`:
  `super_admin`, `operations_admin`, `lab_admin`, `customer_support`,
  `finance_admin`, `content_admin`. Don't render a section a role can't
  access.
- Sections grouped: ops, catalog, operations (field), finance, content,
  system. Centralized mutable state lives at the top of `AdminDashboard`
  so child sections can CRUD without prop-drilling.

## Persistence layer (mock vs. Supabase)

Today's source of truth is **mock + localStorage**. Supabase exists but
is not connected to the live UI; do not assume any read or write reaches
the database.

| Domain | Today | Where |
|---|---|---|
| Auth / session | mock + localStorage | `lib/auth.ts` (key: `makhbartak.session.v1`) |
| **Order create + customer/admin order list + detail read** | **Phase 1 wired: Supabase via `/api/orders` (server route + service role)** | `app/api/orders/*`, `lib/orders-api.ts`, `lib/supabase/server-admin.ts`, RPC `place_order_admin` (migration 010); in-memory mirror in `lib/store.ts` for snappy UX; hydrate on mount in `OrdersList` + `OrdersAdmin` |
| Order status mutations (admin/nurse/lab actions) | mock + fire-and-forget RPC (Phase 2) | `lib/store.ts` setOrderStatus / assignNurse / assignLab / verifyPatient / addNote / openLabIssue / cancelOrder / rescheduleOrder / confirmResultsReady / forceCompleteOrder |
| Lab result PDFs | in-memory `OrderResultFile` rows + optional Supabase Storage upload | `lib/store.ts`, `lib/supabase/storage.ts` |
| Nurse visit state | localStorage per-day | `makhbartak.nurse.prep:<date>`, `makhbartak.nurse.started:<date>` |
| Patients / addresses / payment pref | localStorage primary, Supabase secondary | `lib/profile.ts`, `lib/payment-pref.ts` |
| System settings | localStorage write, Supabase one-shot read | `lib/system-settings.ts` (key: `makhbartak.system-settings.v1`) |
| Catalog (tests, packages, instructions) | mock seed | `lib/mock-data.ts` (Supabase fetch is one-shot, no invalidation) |
| Content pages | localStorage primary | `lib/content-pages.ts` |

Rules until full Supabase wiring is approved:
- Treat in-memory writes as authoritative for non-Phase-1 flows. Do not
  introduce code paths that need a Supabase round-trip to render correctly.
- Do not widen RLS policies, do not add anon-write policies, do not seed
  insecure auth bypasses.
- Do not modify earlier `supabase/migrations/*` files. New work goes in a
  new migration with a higher number. Phase 1 added `010_*`.
- When adding a setting or field that the frontend cares about, add it
  to `SystemSettings` (mock) only; the matching SQL column will be
  added in the migration pass.

### Phase 1 server-route rules
- The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is **server-only**.
  Never reference it from any `"use client"` module or any file
  importable from one. `lib/supabase/server-admin.ts` enforces this with
  `import "server-only"`.
- `/api/orders` routes are the *only* callers of the service-role client
  in Phase 1. The browser never invokes `place_order_admin` or any other
  service-role RPC directly.
- The mock session passed in the POST body is trusted at the same level
  as today's `localStorage` — there is no stronger boundary while mock
  auth is in charge. When real Supabase Auth lands, the route handlers
  shrink to passthroughs (or are removed) and writes happen browser-side
  via `place_order` against an authenticated session.

## Mock data rules

- **All data is in `src/lib/mock-data.ts`.** Don't fetch, don't add SDKs,
  don't introduce a "real API" client. When a back-end engineer wires this
  up later, they will replace the imports — keep that boundary clean.
- **Ids are stable string slugs** (`t-1`, `pkg-2`, `ord-3`, `nur-1`,
  `ad-1`, …). Stick to that pattern for any new fixtures.
- **Images are Picsum** via the `img(seed, w, h)` helper at the top of
  `mock-data.ts`. Use the helper for new fixtures so seeds stay
  reproducible. Allowed remote hosts are listed in `next.config.ts`
  (`picsum.photos`, `fastly.picsum.photos`, `images.unsplash.com`).
- **Arabic copy lives next to the data** (`nameAr`, `descriptionAr`,
  `labelAr`, `instructionsAr`). Don't add a separate i18n layer; this is
  Arabic-first, not multilingual.
- Helpers belong in `mock-data.ts` (`validateCoupon`, `generateInvoice`,
  `buildPrepChecklist`, `getShiftConfigs`, `canAccess`). Extend them
  there — don't sprinkle business logic across components.
- Don't mutate the exported arrays in place. Components should `useState`
  with the imported array as the initial value (the pattern used in
  `AdminDashboard` and `LabPortal`).

## Code quality standards

- TypeScript **strict** is on. No `any`. Reuse the unions in `types.ts`
  (`OrderStatus`, `Shift`, `PaymentMethod`, `AdminRole`, …) — don't widen
  them to `string`.
- Prefer pure functions and small components. The big-component pattern
  (AdminDashboard, NurseApp) is allowed when it keeps related state
  co-located; new screens should still start small.
- Class strings: keep readable. Use `cn(...)` to compose; don't inline
  10-class ternaries when a variable would help.
- Accessibility:
  - Every interactive element has an `aria-label` when its label is an
    icon-only or otherwise non-text.
  - `aria-pressed` for toggles, `aria-current` for active nav items,
    `aria-busy` for loading, `aria-disabled` for disabled CTAs.
  - Visible focus state — handled globally in `globals.css`. Don't remove
    the outline.
  - Touch target ≥ 44×44.
- Run `npm run lint` before declaring a task done. Warnings should be
  treated as errors unless they're in framework-generated files.

## What not to do

- **Don't trust your Next.js training data.** APIs in 16.x may be renamed,
  removed, or behave differently. Cross-check against
  `node_modules/next/dist/docs/` and any deprecation notices in build
  output before writing routing, layout, font, image, server-action, or
  middleware code.
- **Don't introduce a real API, database, auth provider, or state library.**
  Mock data only. If you need persistence beyond `localStorage`, ask first.
- **Don't add emojis to the UI.** Use lucide-react icons or inline SVG.
- **Don't add gradients, drop shadows, or colored backgrounds beyond the
  approved palette.** One hero gradient max; no decorative shadows on cards.
- **Don't push a new page where a `BottomSheet` or `FullScreenModal` works.**
- **Don't translate or i18n the app.** Arabic is the product, not a locale.
- **Don't hard-code status strings, role names, or shift hours.** Use the
  unions, label maps, and helpers in `lib/`.
- **Don't add per-test result PDFs** — files belong to the order
  (`OrderResultFile`).
- **Don't add comments that restate what the code does.** Only comment the
  *why* (a constraint, an invariant, a workaround). Multi-paragraph
  docstrings are forbidden.
- **Don't add backwards-compat shims, dead exports, or "// removed"
  placeholders.** Just delete what's unused.
- **Don't bypass `cn()`** — concatenated class strings make conflicting
  Tailwind utilities silently win in the wrong order.
- **Don't override RTL or `dir="rtl"`** at the component level.

## How to test before finishing

This repo has no automated tests. Verify your change manually:

1. **Lint + build must pass**:
   ```bash
   npm run lint
   npm run build
   ```
2. **Run the dev server** and exercise the affected app(s):
   ```bash
   npm run dev
   ```
   - `/` — sign in as `customer1 / customer123`, walk through Home →
     Package (or Prescription / Custom) → BookingFlow → Cart → Success.
     Confirm bottom-nav switches feel instant; flow transitions feel
     spring-y; back button arrow points the right direction (→ in RTL).
   - `/admin` — log in as `admin / admin123` (super_admin) and as a
     scoped role (e.g. `content / content123`) to confirm permission
     gating actually hides sections.
   - `/nurse` — sign in as `nurse1 / nurse123`. Confirm the prep
     checklist gates "Start Day" and that localStorage keys
     (`makhbartak.nurse.prep:<date>`, `makhbartak.nurse.started:<date>`)
     clear on logout / across days.
   - `/lab` — sign in as `sham-admin / sham123`. Confirm filtering,
     status changes, and PDF upload/delete on an order persist in
     component state.
3. **Mobile + desktop**: resize down to ~375px width; the customer and
   nurse apps must stay phone-shaped, the lab and admin apps must reflow
   to the desktop layout.
4. **RTL sanity**: numbers/prices/phones stay LTR; back arrows point
   right; no clipped text against the wrong edge; logical-property
   utilities (`ms-*`, `me-*`, `text-start/end`) used over directional
   ones.
5. **Reduced motion**: in DevTools, emulate `prefers-reduced-motion:
   reduce` and confirm the affected screen still works (no animation
   stuck mid-state, content visible).
6. **Accessibility quick pass**: tab through the new UI — visible focus
   ring, every icon-only control has a label, touch targets feel ≥ 44px.

If you can't actually run the UI (e.g. headless), say so explicitly in
your hand-off rather than claiming the change works.

---

## Stage 6 — Critical product rules

These rules **supersede** anything earlier in this file when they conflict.
They reflect the current state of the prototype and must be honored on any
new work.

### Customer status (six buckets, no `result_ready`)
- The customer-facing strip has **6** steps:
  `received → confirmed → on_the_way → sample_collected → in_lab → completed`.
- A 7th implicit state, **`needs_attention`**, surfaces failures
  (`failed_to_collect`, `lab_issue`, `cancelled`).
- Internal `result_ready` exists in `OrderStatus` but is **never** rendered
  to the customer. `toCustomerStatus("result_ready")` returns `"completed"`.
- Lab confirms uploads → order auto-completes → customer sees "مكتمل" with
  PDFs as the dominant element. Use `confirmResultsReady(orderId, ref)` to
  trigger the auto-complete; it refuses if no active result file exists.
- A single "اكتمل طلبك" customer notification fires on `completed`.

### Public order numbers
- Every order has a customer-facing **`publicNumber`** (`HL-YYYY-XXXXXX`).
- Customer surfaces (Orders list, OrderDetails, OrderSuccess, notifications,
  invoices the customer sees) **must** render `customerOrderRef(order)`,
  never the internal `id`.
- Admin and lab portals may show both. Helpers live in `lib/order-utils.ts`
  (`generateOrderNumber`, `customerOrderRef`).

### Payment-gated workflow
- `isOrderActionable(order, settings)` from `lib/order-utils.ts` is the
  single rule:
  - `paymentMethod === "cash"` → actionable when `settings.allowCashOrders`
    is `true` (default).
  - `paymentMethod === "online"` → actionable only when
    `paymentStatus === "paid"`.
- Nurse route stops, admin nurse-assignment, and any auto-progression must
  gate on this rule. **Unpaid online orders never appear to the nurse.**
- Toggle for `allowCashOrders` lives in admin Settings and is persisted via
  `lib/system-settings.ts`.

### Result file lifecycle (no destructive deletes)
- `OrderResultFile` has `isActive` + `archivedAt` + `archivedBy` +
  `replacedById`. Files are archived, never deleted.
- Mutators in `lib/store.ts`:
  - `uploadResultFile(orderId, { …, replacesFileId? })` — atomic
    upload-and-replace when `replacesFileId` is set.
  - `archiveResultFile(orderId, fileId, ref)` — sets `isActive=false`.
  - `restoreResultFile(orderId, fileId, ref)` — flips it back.
- Customer reads only **active** files. Admin sees archived rows muted with
  a "استعادة" action.
- Every change emits an `OrderFileEvent` (`uploaded` / `replaced` /
  `archived` / `restored`). Both lab portal and admin OCC render the file
  activity log per order.
- Multi-PDF upload: lab portal uses `<input multiple>` and creates one
  `OrderResultFile` per selected file. Replace flow uses a single-file
  picker.

### Instruction dedup
- Tests share instructions ("صيام 8 ساعات" appears across blood panels).
  Use `dedupeInstructions(instructions)` from `lib/order-utils.ts` whenever
  rendering instructions on order success / order details / nurse visit.
- Dedup key = `Instruction.id` (preferred) or `icon|textAr` fallback.

### Customer auth — username/password, no guest browsing
- The customer app requires sign-in before any screen renders. There is
  no guest mode and no OTP / phone / email flow. `app/page.tsx` checks
  `useSession()` and renders `<CustomerLogin />` until the session role
  is `"customer"`.
- All four portals (customer, nurse, lab, admin) share `LoginForm` from
  `components/auth/LoginForm.tsx`. The unified credential store lives
  in `lib/auth.ts`; per-role mock seed lists are
  `MOCK_CUSTOMER_USERS`, `MOCK_NURSE_USERS`, `MOCK_ADMINS`,
  `MOCK_LAB_USERS`.
- Demo credentials are surfaced under a collapsible on each login
  screen (prototype only — remove when real auth lands).
- Logout is a single call to `logout()` from `lib/auth.ts`. It clears
  the session key `makhbartak.session.v1`; all four portals re-render
  to their login screen via `useSession()`.

### Admin "no popups" rule
- Heavy details belong in **inline pages** or full-height side drawers,
  not in modal dialogs. Existing OCC and User Profile remain modals for
  now (legacy); new admin detail surfaces must be inline pages.
- Quick edits (lab user CRUD, address edit, password reset, single
  confirmations) stay as modals or sheets — they are short, focused, and
  benefit from preserving page context.

### Lab portal rules
- Username/password auth via the unified store in `lib/auth.ts`
  (seeded from `MOCK_LAB_USERS`). Inactive users can't log in.
- Sections in the sidebar: Orders / رفع النتائج / مشاكل المخبر / المحاسبة
  (lab_admin or lab_accounting only) / إعدادات المخبر (lab_admin only).
- **Lab never sees customer sell prices** unless `lab.revealSellPriceToLab`
  is true. Accounting view always shows the lab's agreed amount via
  `computeOrderLabAmount`, never platform margin.
- **Critical lab fields** — only main admin may edit:
  `officialName`, `registrationNumber`, `licenseNumber`, `taxNumber`,
  `addressFull`, `lat`, `lng`, `revealSellPriceToLab`. Defined as
  `CRITICAL_LAB_FIELDS` in `lib/lab-overrides.ts`. `updateLabSelf` strips
  these from any incoming patch.
- Lab admin may edit name (AR/EN), logo, contact phones/email/whatsapp,
  working hours, sample types, supported cities, and branding.

### Nurse rules
- Nurse profile is editable from Settings tab (name, photo via file
  picker → `data:` URL, city). Phone and `isActive` are admin-only.
  Persistence via `lib/nurse-profile.ts`.
- Today's stops filter through `isOrderActionable`. Unpaid online orders
  never reach the nurse list.

### Toast feedback
- Every save / update / delete / upload action in admin / lab / nurse /
  customer **must** call `useToast()` with one of:
  - `toast.success("تم الحفظ بنجاح")` / `"تم الحذف"` / `"تم رفع الملف بنجاح"`
  - `toast.error("حدث خطأ، حاول مرة أخرى")`
- Provider mounted at root layout; works across every app surface.
- Loading/success-error already standardized on `Button.loading` (sets
  `aria-busy` and disables the button).

### Package items in admin
- When an order's `packageSnapshot` is present, the admin OCC Items tab
  renders a **package parent card** + an **expandable child list** of
  included tests for operations.
- Customer cart and OrderDetails always show the package as **one item**.

### Lab issue customer message
- `LabIssue.customerMessageAr` is admin-editable from `LabsAdmin → orders →
  issues card`. Customer banner reads this; falls back to
  `DEFAULT_LAB_ISSUE_CUSTOMER_MESSAGE_AR`.
- Never expose internal `description` to the customer.

---

## Stage 6 — Extended QA checklist

Manual checks before declaring a Stage 6+ change done:

- [ ] **Customer login required**: `/` shows the customer login screen on
      first load. Sign in as `customer1 / customer123`; Home / package
      details / custom builder / prescription / Orders / Account all
      become reachable.
- [ ] **Wrong-portal login is blocked**: trying to sign into `/admin` with
      `customer1 / customer123` shows "لا تملك صلاحية الوصول…"; the same
      account works on `/`.
- [ ] **Logout returns to login screen**: calling logout from any portal
      drops the user to that portal's `LoginForm`, no stale state.
- [ ] **Refresh keeps session**: after sign-in, hard-refreshing the page
      keeps the user signed in (session persists via
      `makhbartak.session.v1`).
- [ ] **Order number consistency**: order success page shows e.g.
      `HL-2026-000007`. Same number appears in `طلباتي → details`.
- [ ] **Add patient / address**: "+ إضافة مريض جديد" and "+ إضافة عنوان
      جديد" inside BookingFlow open inline forms; saving toasts and
      auto-selects the new entry.
- [ ] **Nurse profile**: edit name + upload a photo. Save → toast → reload
      `/nurse` → photo persists. Phone is locked.
- [ ] **Payment gate**: in admin Settings, switch off "السماح بالطلبات
      نقداً" → ord-3 (cash, pending) disappears from `/nurse`. Switch back
      on → reappears.
- [ ] **Multi-PDF upload**: lab portal → ord-4 → "رفع ملفات PDF" → pick 2
      PDFs → both appear as separate active rows.
- [ ] **Replace + archive**: per-row "استبدال" picks one file, the old row
      becomes muted (archived). Per-row `×` archives without deleting.
      "استعادة" in admin OCC restores it.
- [ ] **Auto-complete on confirm**: lab "تأكيد إرسال النتائج" with at
      least one active file flips order to `completed`; customer sees
      "مكتمل" with PDF CTAs at top.
- [ ] **Force-complete**: admin OCC "إغلاق دون نتائج" requires a reason;
      logged in timeline.
- [ ] **Instruction dedup**: an order with multiple fasting tests shows
      "صيام 8 ساعات" once.
- [ ] **Package parent/child in admin**: ord-1 (package) → OCC Items tab
      shows the package card + expandable children list. Customer cart
      shows the package as one row.
- [ ] **Lab no sell price**: by default lab portal hides `priceSnapshot`
      and order total. Admin edits `revealSellPriceToLab` → re-login lab
      → prices appear.
- [ ] **Lab settings**: lab_admin sees "إعدادات المخبر". Save edits to
      portal name + branding colors → reflects on lab sidebar header.
      Critical fields show as read-only.
- [ ] **Lab accounting hidden for uploader**: create a `lab_uploader`
      user from admin → log in → no Accounting tab.
- [ ] **Toast everywhere**: every admin save/edit/delete and lab
      upload/archive/replace shows a toast.
