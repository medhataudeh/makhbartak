-- ============================================================================
-- 002_init_tables.sql
-- Tables, foreign keys, triggers (updated_at).
-- Run after 001_init_enums.sql.
-- ============================================================================

-- ── updated_at trigger helper ----------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- IDENTITY: profiles + role-specific extension tables
-- ============================================================================

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          public.user_role not null default 'customer',
  full_name     text,
  phone         text,
  photo_url     text,
  is_active     boolean not null default true,
  language      text not null default 'ar',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Customer extension (one row per customer profile).
create table public.customers (
  id                       uuid primary key default uuid_generate_v4(),
  profile_id               uuid not null unique references public.profiles(id) on delete cascade,
  preferred_payment_method public.payment_method,
  default_address_id       uuid,           -- FK added below (cyclic)
  default_patient_id       uuid,           -- FK added below
  marketing_opt_in         boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz
);
create trigger trg_customers_updated_at before update on public.customers
  for each row execute function public.tg_set_updated_at();

-- Patients owned by a customer (the person whose sample is being taken).
create table public.patients (
  id           uuid primary key default uuid_generate_v4(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  name         text not null,
  national_id  text,
  note         text,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger trg_patients_updated_at before update on public.patients
  for each row execute function public.tg_set_updated_at();

-- Addresses owned by a customer.
create table public.addresses (
  id           uuid primary key default uuid_generate_v4(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  label        text not null,
  description  text not null,
  city         text not null,
  area         text,
  lat          numeric(9,6),
  lng          numeric(9,6),
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger trg_addresses_updated_at before update on public.addresses
  for each row execute function public.tg_set_updated_at();

-- Now wire the cyclic FKs back to customers.
alter table public.customers
  add constraint fk_customers_default_address
    foreign key (default_address_id) references public.addresses(id) on delete set null;
alter table public.customers
  add constraint fk_customers_default_patient
    foreign key (default_patient_id) references public.patients(id)  on delete set null;

-- ============================================================================
-- LABS + lab users + per-test agreements + settlements
-- ============================================================================

create table public.labs (
  id                       uuid primary key default uuid_generate_v4(),
  name_ar                  text not null,
  name_en                  text,
  logo_url                 text,
  is_active                boolean not null default true,

  official_name            text,
  registration_number      text,
  license_number           text,
  tax_number               text,
  address_full             text,
  city                     text,
  area                     text,
  lat                      numeric(9,6),
  lng                      numeric(9,6),

  phone_main               text not null,
  phone_secondary          text,
  email                    text,
  whatsapp                 text,

  representative_name      text,
  representative_role      text,
  representative_phone     text,
  representative_email     text,

  supported_cities         text[],
  working_hours            text,
  accepted_sample_types    public.sample_type[],
  avg_processing_hours     int,

  primary_color            text,
  secondary_color          text,
  accent_color             text,
  portal_display_name      text,
  header_image_url         text,

  reveal_sell_price_to_lab boolean not null default false,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz
);
create trigger trg_labs_updated_at before update on public.labs
  for each row execute function public.tg_set_updated_at();

-- Lab portal users (lab_admin / lab_accounting / lab_uploader).
-- Tied to auth.users via profile_id; profiles.role for these users is 'lab'.
create type public.lab_user_role as enum ('lab_admin', 'lab_accounting', 'lab_uploader');

create table public.lab_users (
  id            uuid primary key default uuid_generate_v4(),
  profile_id    uuid not null unique references public.profiles(id) on delete cascade,
  lab_id        uuid not null references public.labs(id) on delete cascade,
  role          public.lab_user_role not null,
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger trg_lab_users_updated_at before update on public.lab_users
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- NURSES
-- ============================================================================

create table public.nurses (
  id            uuid primary key default uuid_generate_v4(),
  profile_id    uuid not null unique references public.profiles(id) on delete cascade,
  city          text not null,
  is_active     boolean not null default true,
  -- Gamification snapshot. Detailed stats go in a separate analytics table later.
  total_points  int not null default 0,
  level_name    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger trg_nurses_updated_at before update on public.nurses
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- CATALOG: tests + packages + libraries + agreements
-- ============================================================================

create table public.test_categories (
  id          uuid primary key default uuid_generate_v4(),
  name_ar     text not null,
  name_en     text,
  display_order int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.lab_tests (
  id              uuid primary key default uuid_generate_v4(),
  category_id     uuid references public.test_categories(id) on delete set null,
  name_ar         text not null,
  name_en         text,
  short_name      text,
  aliases_ar      text[] default '{}',
  aliases_en      text[] default '{}',
  sample_type     public.sample_type not null,
  cost_price      numeric(12,2) not null default 0,
  sell_price      numeric(12,2) not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create trigger trg_lab_tests_updated_at before update on public.lab_tests
  for each row execute function public.tg_set_updated_at();

-- Library of customer instructions; tests reference these via lab_test_instructions.
create table public.instruction_library (
  id          uuid primary key default uuid_generate_v4(),
  key         text not null unique,        -- 'fasting_8h', etc.
  title_ar    text not null,
  body_ar     text,
  icon        text,                        -- lucide token
  priority    int  not null default 50,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_instruction_library_updated_at before update on public.instruction_library
  for each row execute function public.tg_set_updated_at();

-- Junction: which library instructions apply to which test.
create table public.lab_test_instructions (
  id                       uuid primary key default uuid_generate_v4(),
  lab_test_id              uuid not null references public.lab_tests(id) on delete cascade,
  library_instruction_id   uuid not null references public.instruction_library(id) on delete cascade,
  -- Optional override fields if admin wants to tailor copy per test.
  title_override_ar        text,
  body_override_ar         text,
  priority_override        int,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  unique (lab_test_id, library_instruction_id)
);

-- Library of nurse tools (needles, tubes, …).
create table public.nurse_tools (
  id         uuid primary key default uuid_generate_v4(),
  name_ar    text not null,
  unit       text not null,                -- 'حبة', 'أنبوب', …
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_nurse_tools_updated_at before update on public.nurse_tools
  for each row execute function public.tg_set_updated_at();

-- Junction: how much of each tool a single test consumes.
create table public.lab_test_required_tools (
  id                  uuid primary key default uuid_generate_v4(),
  lab_test_id         uuid not null references public.lab_tests(id) on delete cascade,
  nurse_tool_id       uuid not null references public.nurse_tools(id) on delete cascade,
  quantity_per_test   int not null default 1,
  required            boolean not null default true,
  note                text,
  created_at          timestamptz not null default now(),
  unique (lab_test_id, nurse_tool_id)
);

-- Packages: bundle of tests at a discounted price.
create table public.packages (
  id                  uuid primary key default uuid_generate_v4(),
  name_ar             text not null,
  name_en             text,
  description_ar      text,
  full_description_ar text,
  category            text,                -- frontend uses 'checkup'/'athletes'/etc.
  price               numeric(12,2) not null,
  original_price      numeric(12,2) not null,
  main_image_url      text,
  mobile_image_url    text,
  desktop_image_url   text,
  badge_ar            text,
  display_order       int not null default 0,
  show_in_slider      boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create trigger trg_packages_updated_at before update on public.packages
  for each row execute function public.tg_set_updated_at();

create table public.package_items (
  id          uuid primary key default uuid_generate_v4(),
  package_id  uuid not null references public.packages(id) on delete cascade,
  lab_test_id uuid not null references public.lab_tests(id) on delete restrict,
  display_order int not null default 0,
  unique (package_id, lab_test_id)
);

-- Per-lab pricing agreement (what platform pays the lab per test).
create table public.lab_price_agreements (
  id              uuid primary key default uuid_generate_v4(),
  lab_id          uuid not null references public.labs(id) on delete cascade,
  lab_test_id     uuid not null references public.lab_tests(id) on delete cascade,
  lab_price       numeric(12,2) not null,
  effective_from  date not null default current_date,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (lab_id, lab_test_id, effective_from)
);

-- ============================================================================
-- ORDERS — bookings, items, status timeline
-- ============================================================================

create table public.orders (
  id                  uuid primary key default uuid_generate_v4(),
  public_number       text not null unique,        -- HL-YYYY-XXXXXX
  customer_id         uuid not null references public.customers(id) on delete restrict,
  patient_id          uuid not null references public.patients(id)  on delete restrict,
  address_id          uuid not null references public.addresses(id) on delete restrict,

  kind                public.order_kind not null,
  package_id          uuid references public.packages(id) on delete set null,
  -- Snapshot of the package (for historical accuracy when admin edits the package).
  package_snapshot    jsonb,

  status              public.order_status not null default 'pending_payment',

  -- Booking
  visit_date          date not null,
  shift               public.shift_window not null,
  shift_start_time    time,
  shift_end_time      time,

  -- Money (snapshots, never recompute from items after creation)
  subtotal            numeric(12,2) not null default 0,
  coupon_id           uuid,                        -- FK below (cyclic with coupons)
  coupon_code         text,
  coupon_discount     numeric(12,2) not null default 0,
  total               numeric(12,2) not null default 0,

  payment_method      public.payment_method not null,
  payment_status      public.payment_status not null default 'pending',

  -- Assignment
  nurse_id            uuid references public.nurses(id) on delete set null,
  lab_id              uuid references public.labs(id)   on delete set null,

  -- Verification + admin notes
  patient_official_name text,
  patient_national_id   text,
  internal_notes       text,
  failed_reason        text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create trigger trg_orders_updated_at before update on public.orders
  for each row execute function public.tg_set_updated_at();

create table public.order_items (
  id                uuid primary key default uuid_generate_v4(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  lab_test_id       uuid not null references public.lab_tests(id) on delete restrict,
  -- Snapshot fields. Never recompute from lab_tests after creation.
  name_ar_snapshot  text not null,
  name_en_snapshot  text,
  price_snapshot    numeric(12,2) not null,
  display_order     int not null default 0,
  created_at        timestamptz not null default now()
);

create table public.order_status_history (
  id          uuid primary key default uuid_generate_v4(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  status      public.order_status not null,
  actor_role  public.user_role,
  actor_id    uuid,                              -- profiles.id (no FK to allow system actor)
  actor_name  text,
  note        text,
  created_at  timestamptz not null default now()
);

-- Optional structured note thread on an order (admin/lab/nurse can add).
create table public.order_notes (
  id           uuid primary key default uuid_generate_v4(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  author_id    uuid references public.profiles(id) on delete set null,
  author_name  text,
  author_role  public.user_role,
  text         text not null,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- PRESCRIPTIONS (customer-uploaded image + extracted matches)
-- ============================================================================

create table public.prescriptions (
  id            uuid primary key default uuid_generate_v4(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  -- Storage path inside `prescriptions` bucket (private).
  image_path    text not null,
  has_unclear   boolean not null default false,
  status        text not null default 'pending', -- pending | reviewed | resolved
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_prescriptions_updated_at before update on public.prescriptions
  for each row execute function public.tg_set_updated_at();

-- Each candidate match line extracted from the prescription image.
create table public.prescription_matches (
  id              uuid primary key default uuid_generate_v4(),
  prescription_id uuid not null references public.prescriptions(id) on delete cascade,
  raw_text        text not null,
  matched_test_id uuid references public.lab_tests(id) on delete set null,
  confidence      numeric(4,3) not null default 0,    -- 0..1
  is_unclear      boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- LAB result files (active vs archived; never hard-deleted)
-- ============================================================================

create table public.lab_result_files (
  id                uuid primary key default uuid_generate_v4(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  lab_id            uuid references public.labs(id) on delete set null,

  storage_path      text not null,         -- inside `lab-results` bucket (private)
  file_name         text not null,
  uploaded_by       uuid references public.profiles(id) on delete set null,
  uploaded_by_name  text,                  -- snapshot for audit
  note              text,

  status            public.result_file_status not null default 'active',
  replaces_id       uuid references public.lab_result_files(id) on delete set null,
  replaced_by_id    uuid references public.lab_result_files(id) on delete set null,

  archived_at       timestamptz,
  archived_by       uuid references public.profiles(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_lab_result_files_updated_at before update on public.lab_result_files
  for each row execute function public.tg_set_updated_at();

-- Per-file lifecycle log (uploaded / replaced / archived / restored).
create table public.lab_result_file_events (
  id           uuid primary key default uuid_generate_v4(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  file_id      uuid references public.lab_result_files(id) on delete set null,
  file_name    text not null,
  event_type   public.result_file_event_type not null,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text,
  actor_role   public.user_role,
  note         text,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- LAB issues (raised against an order)
-- ============================================================================

create table public.lab_issues (
  id                  uuid primary key default uuid_generate_v4(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  lab_id              uuid references public.labs(id) on delete set null,
  type                public.lab_issue_type not null,
  description         text not null,
  customer_message_ar text,
  status              public.lab_issue_status not null default 'open',
  created_by          uuid references public.profiles(id) on delete set null,
  created_by_role     public.user_role,
  resolution_note     text,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_lab_issues_updated_at before update on public.lab_issues
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- RATINGS
-- ============================================================================

create table public.ratings (
  id              uuid primary key default uuid_generate_v4(),
  order_id        uuid not null unique references public.orders(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  nurse_id        uuid references public.nurses(id) on delete set null,
  lab_id          uuid references public.labs(id)   on delete set null,
  nurse_rating    int  check (nurse_rating between 1 and 5),
  lab_rating      int  check (lab_rating   between 1 and 5),
  overall_rating  int not null check (overall_rating between 1 and 5),
  comment         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_ratings_updated_at before update on public.ratings
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- NOTIFICATIONS (per-user inbox)
-- ============================================================================

create table public.notifications (
  id           uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type         public.notification_type not null,
  title_ar     text not null,
  body_ar      text not null,
  -- Loose link to whatever entity the notification is about.
  order_id     uuid references public.orders(id) on delete set null,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- COUPONS
-- ============================================================================

create table public.coupons (
  id                uuid primary key default uuid_generate_v4(),
  code              text not null unique,
  type              public.coupon_type not null,
  value             numeric(12,2) not null,
  min_order_amount  numeric(12,2) not null default 0,
  max_discount      numeric(12,2) not null default 0,
  usage_limit       int not null default 0,        -- 0 = unlimited
  used_count        int not null default 0,
  start_date        date not null,
  expiry_date       date not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_coupons_updated_at before update on public.coupons
  for each row execute function public.tg_set_updated_at();

-- Wire the cyclic FK from orders.coupon_id -> coupons.id
alter table public.orders
  add constraint fk_orders_coupon
    foreign key (coupon_id) references public.coupons(id) on delete set null;

-- ============================================================================
-- PAYMENTS — granular event log; orders.payment_status is the rolled-up state
-- ============================================================================

create table public.payments (
  id              uuid primary key default uuid_generate_v4(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  method          public.payment_method not null,
  amount          numeric(12,2) not null,
  currency        text not null default 'SYP',
  status          public.payment_status not null default 'pending',
  provider        text,                  -- 'cash', 'stripe', 'tabby', …
  provider_ref    text,                  -- gateway transaction id
  paid_at         timestamptz,
  refunded_at     timestamptz,
  raw             jsonb,                 -- gateway payload
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_payments_updated_at before update on public.payments
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- LAB SETTLEMENTS
-- ============================================================================

create table public.settlements (
  id                uuid primary key default uuid_generate_v4(),
  lab_id            uuid not null references public.labs(id) on delete cascade,
  period_start      date not null,
  period_end        date not null,
  total_orders      int not null default 0,
  total_lab_amount  numeric(12,2) not null default 0,
  total_paid        numeric(12,2) not null default 0,
  status            public.settlement_status not null default 'pending',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_settlements_updated_at before update on public.settlements
  for each row execute function public.tg_set_updated_at();

create table public.settlement_items (
  id            uuid primary key default uuid_generate_v4(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  order_id      uuid not null references public.orders(id) on delete restrict,
  lab_amount    numeric(12,2) not null,
  status        public.settlement_status not null default 'pending',
  created_at    timestamptz not null default now(),
  unique (settlement_id, order_id)
);

-- ============================================================================
-- SHORTAGE REQUESTS (nurse → admin)
-- ============================================================================

create table public.shortage_requests (
  id          uuid primary key default uuid_generate_v4(),
  nurse_id    uuid not null references public.nurses(id) on delete cascade,
  date        date not null,
  status      public.shortage_status not null default 'pending',
  note        text,
  admin_note  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_shortage_requests_updated_at before update on public.shortage_requests
  for each row execute function public.tg_set_updated_at();

create table public.shortage_request_items (
  id                  uuid primary key default uuid_generate_v4(),
  request_id          uuid not null references public.shortage_requests(id) on delete cascade,
  nurse_tool_id       uuid not null references public.nurse_tools(id)       on delete restrict,
  requested_quantity  int not null check (requested_quantity > 0),
  created_at          timestamptz not null default now()
);

-- ============================================================================
-- ADMIN audit + content + global app settings
-- ============================================================================

create table public.admin_activity_logs (
  id          uuid primary key default uuid_generate_v4(),
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_name  text not null,
  actor_role  public.user_role not null,
  action      public.activity_action not null,
  entity      text not null,                 -- 'order', 'lab', 'package', …
  entity_id   text not null,
  details     text,
  created_at  timestamptz not null default now()
);

create table public.content_pages (
  id            uuid primary key default uuid_generate_v4(),
  slug          public.content_page_slug not null unique,
  title_ar      text not null,
  body_ar       text not null default '',
  faq_items     jsonb,                       -- [{q, a}, ...]
  support_phone text,
  support_whatsapp text,
  is_active     boolean not null default true,
  updated_at    timestamptz not null default now()
);
create trigger trg_content_pages_updated_at before update on public.content_pages
  for each row execute function public.tg_set_updated_at();

-- Single-row table holding global app settings.
create table public.app_settings (
  id                          int primary key default 1,
  min_booking_notice_minutes  int not null default 120,
  morning_shift_start         time not null default '08:00',
  morning_shift_end           time not null default '10:00',
  evening_shift_start         time not null default '16:00',
  evening_shift_end           time not null default '18:00',
  supported_cities            text[] not null default array['دمشق','ريف دمشق'],
  whatsapp_number             text not null default '+963911000000',
  allow_cash_orders           boolean not null default true,
  booking_horizon_days        int not null default 14,
  max_orders_per_shift        int not null default 0, -- 0 = unlimited
  default_lab_share_pct       int not null default 60,

  branding_primary            text not null default '#0891B2',
  branding_cta                text not null default '#059669',
  branding_accent             text not null default '#ECFEFF',
  branding_logos              jsonb,                  -- {main, header, mobile, desktop, ...}
  background_style            text not null default 'soft-mesh',

  default_tool_ids            uuid[] not null default '{}',
  buffer_pct                  int not null default 15,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);
create trigger trg_app_settings_updated_at before update on public.app_settings
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- HELPER: profile bootstrap on auth.users insert
-- ============================================================================
-- Every new auth.users gets a profiles row (default role: customer).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, phone)
  values (
    new.id,
    'customer',
    coalesce(new.raw_user_meta_data->>'full_name', null),
    coalesce(new.phone, new.raw_user_meta_data->>'phone', null)
  )
  on conflict (id) do nothing;

  -- Materialize a customer extension row too.
  insert into public.customers (profile_id)
  select new.id
  where exists (select 1 from public.profiles where id = new.id)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- ROLE helpers (used by RLS policies in 004)
-- ============================================================================

create or replace function public.current_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_lab_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'lab' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_nurse()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'nurse' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_customer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'customer' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.current_customer_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.customers where profile_id = auth.uid();
$$;

create or replace function public.current_nurse_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.nurses where profile_id = auth.uid();
$$;

create or replace function public.current_lab_id()
returns uuid language sql stable security definer set search_path = public as $$
  select lab_id from public.lab_users where profile_id = auth.uid() and is_active;
$$;
