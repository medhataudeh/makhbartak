# Supabase Database — مختبرك / Makhbartak

This folder contains the production database design + ready-to-run SQL
migrations for the platform. The frontend has **not** been wired to
Supabase yet — that's the next stage and explicitly gated on your approval.

```
supabase/
  migrations/
    001_init_enums.sql
    002_init_tables.sql
    003_init_indexes.sql
    004_init_rls_policies.sql
    005_storage_buckets.sql
    006_seed_demo_data.sql
  README.md          ← this file
```

Run order: **001 → 002 → 003 → 004 → 005 → 006**. Each file is idempotent
where possible (`if not exists`, `on conflict do nothing`); 002 declares
trigger functions and reuses them.

---

## 1. ERD overview

The schema follows a **role-first** layout. `auth.users` (Supabase Auth) is
the source of truth for identity. `profiles` mirrors every auth user with a
`role` enum. Three role-specific extension tables (`customers`, `nurses`,
`lab_users`) hold the operational columns for that role; helpers
`current_customer_id()` / `current_nurse_id()` / `current_lab_id()` resolve
the role context from the JWT.

```
                ┌─────────────────┐
                │   auth.users    │
                └────────┬────────┘
                         │ 1:1 (handle_new_user trigger)
                ┌────────▼────────┐
                │    profiles     │  role enum
                └─┬───────┬───────┘
        customer │       │ lab            │ nurse
       ┌─────────▼─┐ ┌───▼─────┐  ┌───────▼──────┐
       │ customers │ │lab_users│  │   nurses     │
       └─────┬─────┘ └────┬────┘  └──────┬───────┘
             │            │              │
   ┌─────────┼────┐       │              │
   ▼         ▼    ▼       ▼              ▼
patients addresses  labs                shortage_requests
                    │
            lab_price_agreements

CATALOG                              ORDER LIFECYCLE
─────────────────────                ─────────────────────
test_categories ──┐                  orders ─┬─ order_items
                  ▼                          │
lab_tests ────────┼──────────────────────────┼─ order_status_history
   │              │                          │
   │              │ junction                 ├─ order_notes
   ├─ lab_test_instructions ─ instruction_library
   ├─ lab_test_required_tools ─ nurse_tools  ├─ lab_result_files ─ lab_result_file_events
   │                                          │
packages ─ package_items                      ├─ lab_issues
                                              ├─ ratings
PAYMENTS                                      ├─ payments
─────────────────────                         └─ prescriptions ─ prescription_matches
coupons (referenced by orders)
settlements ─ settlement_items

ADMIN / META
─────────────────────
admin_activity_logs   notifications   content_pages   app_settings
```

Two important data invariants:

- **Snapshots, never recompute.** `orders` snapshots its package, items
  prices, coupon discount, shift times, and totals. Editing a `lab_test`'s
  `sell_price` later does not retroactively change historical orders.
- **Soft delete, never destroy.** Most main tables have `deleted_at`.
  `lab_result_files` use `status enum` (`active` / `archived` / `replaced`)
  instead — admin sees archived rows, customer never does.

---

## 2. Tables (full list, ~35)

| Table | Purpose |
|---|---|
| `profiles` | 1:1 mirror of `auth.users` with role + metadata. |
| `customers` | Customer extension (preferred payment, defaults). |
| `patients` | Patients owned by a customer. |
| `addresses` | Addresses owned by a customer. |
| `labs` | Partner lab profile + portal branding + critical official fields. |
| `lab_users` | Lab portal logins (lab_admin / lab_accounting / lab_uploader). |
| `nurses` | Nurse extension (city, gamification snapshot). |
| `test_categories` | Catalog category. |
| `lab_tests` | The product unit. |
| `instruction_library` | Admin-curated catalog of customer instructions. |
| `lab_test_instructions` | Junction `lab_tests` ↔ `instruction_library`. |
| `nurse_tools` | Admin-curated catalog of nurse kit items. |
| `lab_test_required_tools` | Junction `lab_tests` ↔ `nurse_tools` with quantity. |
| `packages` | Bundle of tests at a discounted price. |
| `package_items` | Junction `packages` ↔ `lab_tests`. |
| `lab_price_agreements` | Per-lab agreed price per test. |
| `orders` | Customer booking. Snapshots package + totals + shift window. |
| `order_items` | Per-test line items, snapshotted at create-time. |
| `order_status_history` | Append-only timeline of status transitions. |
| `order_notes` | Structured admin/lab/nurse notes thread. |
| `prescriptions` | Customer-uploaded prescription image (Storage path). |
| `prescription_matches` | Extracted candidate lines from a prescription. |
| `lab_result_files` | Per-order PDFs with `status` enum (no hard delete). |
| `lab_result_file_events` | Append-only file lifecycle log. |
| `lab_issues` | Lab-raised issue against an order. |
| `ratings` | One rating per order: nurse + lab + overall + comment. |
| `notifications` | Per-user inbox. |
| `coupons` | Promo codes. |
| `payments` | Granular payment events; rolled-up status sits on `orders`. |
| `settlements` | Monthly platform↔lab settlement header. |
| `settlement_items` | Per-order lines inside a settlement. |
| `shortage_requests` | Nurse-filed kit-shortage request. |
| `shortage_request_items` | Per-tool quantities inside a shortage request. |
| `admin_activity_logs` | Admin audit (every consequential write). |
| `content_pages` | CMS pages (terms / privacy / support / FAQ). |
| `app_settings` | Singleton config row (id=1). |

---

## 3 + 4 + 5. Columns / data types / keys

See `002_init_tables.sql` — every column lists its type, `not null` /
`default`, and FK reference inline. Highlights:

- **All primary keys are UUID** (`uuid_generate_v4()`), except `app_settings`
  which is a `int` singleton with a `check (id = 1)`.
- **Timestamps**: `created_at` / `updated_at` on every main table, with a
  `tg_set_updated_at()` BEFORE-UPDATE trigger.
- **Soft delete**: `deleted_at timestamptz` on `profiles`, `customers`,
  `patients`, `addresses`, `labs`, `lab_users`, `nurses`, `lab_tests`,
  `packages`, `orders`. (Lab result files use `status enum` instead.)
- **Snapshots**: `orders.package_snapshot jsonb`, `orders.coupon_code text`,
  `order_items.{name_ar_snapshot,name_en_snapshot,price_snapshot}`,
  `orders.shift_start_time/shift_end_time time`.
- **Money**: `numeric(12,2)` everywhere. Currency stored on `payments`
  (default `'SYP'`).
- **Cyclic FKs** (customers↔addresses↔patients, orders↔coupons) are added
  in a second `alter table` step inside `002_init_tables.sql` to avoid
  forward-reference errors.

---

## 6. Indexes

See `003_init_indexes.sql`. Key composite + partial indexes:

- `idx_orders_nurse_date` — `(nurse_id, visit_date, shift) where status not in ('cancelled','refunded')` — drives the nurse "today" query.
- `idx_orders_lab_status` — `(lab_id, status)` — drives the lab portal list.
- `idx_orders_customer_recent` — `(customer_id, created_at desc)`.
- `idx_lab_result_files_active` — partial on `status = 'active'` so the
  customer-facing query stays a single index scan.
- `ux_patients_one_default` / `ux_addresses_one_default` — partial
  `unique` indexes per customer enforcing a single default row.
- `idx_lab_issues_lab_open` — partial on unresolved issues per lab.

---

## 7. Enum types

Defined in `001_init_enums.sql`:

`user_role`, `order_status`, `payment_method`, `payment_status`,
`shift_window`, `order_kind`, `sample_type`, `lab_issue_type`,
`lab_issue_status`, `result_file_status`, `result_file_event_type`,
`notification_type`, `settlement_status`, `shortage_status`, `coupon_type`,
`content_page_slug`, `activity_action`, `lab_user_role`.

`order_status` covers the production state machine you specified
(`pending_payment` → `paid` → `assigned` → `nurse_on_way` →
`sample_collected` → `received_by_lab` → `processing` → `results_uploaded`
→ `completed`, plus `cancelled` / `refunded`).

---

## 8. Row Level Security

See `004_init_rls_policies.sql`. RLS is enabled on **every** domain table.
Pattern:

- Helper SECURITY DEFINER functions: `is_admin()`, `is_lab_user()`,
  `is_nurse()`, `is_customer()`, `current_customer_id()`,
  `current_nurse_id()`, `current_lab_id()`, `current_role()`.
- **Customers** see only rows tied to their own `customers.id`.
- **Nurses** see only rows tied to their own `nurses.id` (orders +
  patient/address/instructions of those orders).
- **Lab users** see only rows tied to their own `lab_id`.
- **Admins** can do everything via `is_admin()` — both `using` and
  `with check`.
- **Catalog** (tests / packages / instructions / tools) is read-open to any
  authenticated user (active rows), write-restricted to admin.
- **service_role** bypasses RLS — use it for backend tasks like cron jobs
  and webhooks.

Critical fields on `labs` (`official_name`, `license_number`, …,
`reveal_sell_price_to_lab`) are *policy-allowed* for self-update by lab
admin in raw SQL — the API layer (or an optional `BEFORE UPDATE` trigger)
must enforce the column-level guard. The README in CLAUDE.md documents this.

---

## 9. Storage buckets

See `005_storage_buckets.sql`.

| Bucket | Public | Path convention | Who can write |
|---|---|---|---|
| `public-assets` | yes | `*` | admin |
| `nurse-photos` | yes | `<profile_id>/*` | nurse self + admin |
| `lab-branding` | yes | `<lab_id>/*` | lab admin self + admin |
| `prescriptions` | **no** | `<customer_id>/*` | customer self + admin |
| `lab-results` | **no** | `<order_id>/*` | lab assigned + admin; customer reads ACTIVE files only |

The `lab-results` customer-read policy joins through
`public.lab_result_files` and only allows reads where a corresponding row
has `status = 'active'`. This means archived files are inaccessible even
via a direct CDN URL — they remain visible to admin via the bucket
admin-all policy.

---

## 10. SQL migrations

All in `supabase/migrations/`. To apply:

**Option A — Supabase SQL Editor (fastest for staging):**
1. Open project → SQL Editor → New query.
2. Paste each file in order, click Run, repeat 001 → 006.

**Option B — Supabase CLI:**
```bash
npx supabase login
npx supabase link --project-ref <your-ref>
npx supabase db push
```

The migrations are dependency-correct and have been kept idempotent where
possible. Two notes:

- `002` registers a trigger on `auth.users` (`on_auth_user_created`) that
  automatically inserts a `profiles` row + `customers` row for every new
  auth user. If you'd rather handle that in your API code, drop the
  trigger and remove `handle_new_user`.
- `006` does NOT seed `auth.users`. Create demo users via the dashboard
  or `supabase.auth.admin.createUser` and update `profiles.role` for
  admin / lab / nurse accounts.

---

## 11. Demo seed

`006_seed_demo_data.sql` ships:

- 8 test categories, 10 lab tests, 7 instructions, 8 nurse tools.
- 2 packages with their items.
- 2 coupons (`WELCOME30`, `FIXED10`).
- 2 labs (Sham, Al Nour) with branding + `lab_price_agreements`.
- 4 content pages (terms / privacy / support / FAQ).
- The `app_settings` singleton (id=1).

**You must create the auth users yourself** — see the suggested credentials
inside the seed file's header comment and post-create:

```sql
-- After creating admin@example.com via Auth dashboard:
update public.profiles set role = 'admin' where id = '<admin uid>';
-- After creating sham-admin@example.com:
update public.profiles set role = 'lab' where id = '<lab uid>';
insert into public.lab_users (profile_id, lab_id, role)
values ('<lab uid>', '77777777-7777-7777-7777-000000000001', 'lab_admin');
-- After creating nurse1@example.com:
update public.profiles set role = 'nurse' where id = '<nurse uid>';
insert into public.nurses (profile_id, city) values ('<nurse uid>', 'دمشق');
```

---

## 12. Environment variables

Add to `.env.local` (and to Vercel project settings → Env Vars):

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from project settings>

# Server-only (do NOT prefix with NEXT_PUBLIC_):
SUPABASE_SERVICE_ROLE_KEY=<service_role key — for cron jobs, admin scripts, webhooks>

# Optional, future:
SUPABASE_JWT_SECRET=<for verifying JWTs server-side>
```

Update `.env.example` accordingly when wiring the frontend.

---

## 13. Mapping: current frontend mock files → new tables

| Frontend source | Maps to Supabase table(s) |
|---|---|
| `MOCK_TESTS` (mock-data.ts) | `lab_tests` (+ `test_categories`) |
| `MOCK_PACKAGES` | `packages` + `package_items` |
| `MOCK_LIBRARY_INSTRUCTIONS` | `instruction_library` |
| `MOCK_LIBRARY_TOOLS` | `nurse_tools` |
| `Test.customerInstructions` | `lab_test_instructions` (junction) |
| `Test.nurseTools` | `lab_test_required_tools` (junction) |
| `MOCK_LABS` | `labs` |
| `MOCK_LAB_USERS` | `lab_users` (also create `auth.users`) |
| `MOCK_LAB_PRICE_AGREEMENTS` | `lab_price_agreements` |
| `MOCK_LAB_SETTLEMENTS` / `…ITEMS` | `settlements` / `settlement_items` |
| `MOCK_NURSES` | `nurses` (also create `auth.users`) |
| `MOCK_NURSE_ROUTES` | implicit — derived by querying `orders` filtered by nurse + visit_date + shift |
| `MOCK_PATIENTS` | `patients` |
| `MOCK_ADDRESSES` | `addresses` |
| `MOCK_ORDERS` | `orders` + `order_items` + `order_status_history` |
| `MOCK_RESULT_FILES` | `lab_result_files` (with `status='active'`) + `lab_result_file_events` |
| `MOCK_NOTIFICATIONS` / `MOCK_NURSE_NOTIFICATIONS` | `notifications` (with `recipient_id`) |
| `MOCK_COUPONS` | `coupons` |
| `MOCK_INVOICES` | derived (computed view from `orders` + `payments` + `coupons`) |
| `MOCK_ORDER_RATINGS` | `ratings` |
| `MOCK_CONTENT_PAGES` | `content_pages` |
| `MOCK_ACTIVITY_LOGS` | `admin_activity_logs` |
| `MOCK_ICONS` | drop (icons are tokens, not data) |
| `MOCK_SLIDERS` | a future `home_sliders` table — not in this migration; admin manages from `app_settings.branding_logos` for now |
| `SYSTEM_SETTINGS` | `app_settings` (singleton) |
| `NURSE_CHECKLIST_DEFAULTS` | columns on `app_settings` |
| `BrandingConfig` | columns on `app_settings` |
| `lib/branding.ts` (localStorage `makhbartak.branding.v1`) | `app_settings.branding_*` columns |
| `lib/system-settings.ts` (`makhbartak.system-settings.v1`) | `app_settings` |
| `lib/payment-pref.ts` (`makhbartak.payment.preferred`) | `customers.preferred_payment_method` |
| `lib/profile.ts` (`makhbartak.profile.patients.v1` / `…addresses.v1`) | `patients` / `addresses` |
| `lib/nurse-profile.ts` (`makhbartak.nurse-profile.v1`) | `nurses` / `profiles` |
| `lib/lab-overrides.ts` (`makhbartak.lab-overrides.v1`) | `labs` (lab_admin self-update) |
| `lib/instruction-library.ts` | `instruction_library` |
| `lib/tool-library.ts` (tools + `…checklist-defaults.v1`) | `nurse_tools` + `app_settings.{default_tool_ids,buffer_pct}` |
| `lib/content-pages.ts` | `content_pages` |
| `lib/lab-auth.ts` (`makhbartak.lab.session.v2` + `lab-users.v1`) | Supabase Auth + `lab_users` |
| `lib/store.ts` (in-memory orders + notifications + lab issues + file events) | `orders`, `order_status_history`, `notifications`, `lab_issues`, `lab_result_files`, `lab_result_file_events` |
| `lib/ratings.ts` | `ratings` |
| `lib/shortage-requests.ts` | `shortage_requests` + `shortage_request_items` |
| `lib/settlements.ts` | `settlements` + `settlement_items` |
| `lib/activity-log.ts` | `admin_activity_logs` |

The migration intentionally **does not** ship a sliders table or a separate
`icons` table — those are content the admin already edits via the
branding/CMS surfaces.

---

## 14. Step-by-step integration plan

I'm pausing here per your instructions — confirm before I touch the
frontend. When you say "go", the order will be:

1. **Wire Supabase client.** Create `src/lib/supabase/client.ts` (browser
   client) and `src/lib/supabase/server.ts` (route handler / RSC client).
   Add the env vars to `.env.local` + `.env.example`.
2. **Auth bootstrap.** Replace `LoginModal` OTP stub with
   `supabase.auth.signInWithOtp({ phone })` + `verifyOtp`. Wire admin
   login (`signInWithPassword` against `auth.users`). Wire lab portal
   login (replace the in-memory `loginLabUser` with
   `signInWithPassword` against the lab_users' linked auth account).
   Remove the nurse "logged out" placeholder in favor of
   `supabase.auth.signOut()`.
3. **Read paths first**, in order of safety:
   - `app_settings` → swap `lib/system-settings.ts` to a Supabase-backed
     hook with realtime updates; admin write goes to `update`.
   - `content_pages` → swap `lib/content-pages.ts`.
   - `instruction_library`, `nurse_tools` → swap library hooks.
   - `lab_tests`, `packages`, `package_items` → catalog.
   - `coupons` → swap `validateCoupon` to call a Postgres RPC.
4. **Customer profile**: swap `lib/profile.ts` (patients/addresses) and
   `lib/payment-pref.ts` to RLS-protected reads/writes.
5. **Order create flow**: replace `createOrder()` in `lib/store.ts` with a
   transactional Supabase RPC `rpc_create_order(input jsonb) → orders.id`
   that inserts `orders` + `order_items` + initial `order_status_history`
   + a `notifications` row inside one transaction. The idempotency key
   becomes `orders.public_number` (or a separate column).
6. **Order updates**: status changes go through an RPC
   `rpc_set_order_status(order_id, status, note)` that writes
   `order_status_history` + `notifications` atomically.
7. **Lab portal**: swap result-file CRUD to inserts on
   `lab_result_files` + `lab_result_file_events`. PDF upload goes to the
   `lab-results` Storage bucket using the path convention
   `<order_id>/<filename>`.
8. **Realtime subscriptions** (optional first pass): subscribe to
   `orders` (admin), `order_status_history` (customer + admin),
   `lab_result_files` (customer + admin), `notifications` (recipient).
9. **Cron-like jobs** (Supabase scheduled functions or a Vercel cron):
   - Generate lab settlements monthly.
   - Auto-cancel `pending_payment` orders older than N hours.
10. **Cut over**. Keep the localStorage stores as a feature-flag escape
    hatch behind a `NEXT_PUBLIC_USE_SUPABASE` boolean for one release,
    then delete the mock layer.

---

## 15. Risks + production notes

- **`auth.users` trigger.** The `handle_new_user()` trigger in `002`
  bootstraps a `profiles` row on every new auth user. If your sign-up
  flow needs to set `full_name` / `phone` server-side BEFORE the trigger
  runs, supply them via `raw_user_meta_data` on the auth admin call.
- **Cyclic FKs.** `customers.default_address_id` ↔ `addresses.customer_id`
  and `orders.coupon_id` ↔ `coupons` are wired via deferred `alter table`
  steps inside `002` — re-running `002` after a partial failure may
  complain about duplicate constraint names; drop them and re-run.
- **`reveal_sell_price_to_lab` and other "critical" lab fields.** The RLS
  policy allows lab self-update of the row but does not enforce the
  column-level guard. **Implement that in your API layer** (Next.js route
  handlers) or add a `BEFORE UPDATE` trigger. The guard list lives in
  `CLAUDE.md` Stage 6 docs and `lib/lab-overrides.ts`'s
  `CRITICAL_LAB_FIELDS`.
- **Customer-facing lab issue copy.** Postgres has no column-level RLS.
  Customers can `SELECT *` from `lab_issues` for their own orders today.
  When you wire reads, the customer client must select only
  `customer_message_ar` (and never `description`). Production-ready
  alternative: create a `lab_issues_public` view that exposes only safe
  columns and lock the policy to that view. Documented but not enforced
  in DDL.
- **Result files vs. Storage.** A `lab_result_files` row referencing a
  storage path that no longer exists is allowed. Add a Storage trigger
  or a soft check before serving.
- **Settlement generation race.** When admin clicks "generate", make sure
  no two admins fire it twice for the same period — the table doesn't
  have a `unique (lab_id, period_start, period_end)`. Add it before
  shipping if procurement runs concurrently.
- **Coupon `usage_limit` enforcement.** Increment `used_count` inside the
  same RPC transaction as `orders.insert` and re-check the limit.
- **Soft-delete + RLS.** Most policies do **not** filter `deleted_at`.
  Application queries should `.is('deleted_at', null)`. Or add a
  `where deleted_at is null` clause to each policy in production.
- **PII handling.** `prescriptions` and `lab-results` are PHI.
  Buckets are private and policy-gated, but you should also enable
  Storage logging + retention policies in Supabase project settings.
- **Backups.** Supabase nightly PITR comes with paid plans. Confirm before
  go-live.
- **Realtime cost.** Subscribing to `notifications` for every signed-in
  customer can add up. Filter by `recipient_id` server-side if you wire
  realtime, and only subscribe while a relevant screen is open.
