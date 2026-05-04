-- ============================================================================
-- 025_branding_and_ratings.sql
-- Production hardening Phase 1:
--   * app_branding singleton — admin-managed logos/theme/background. Replaces
--     localStorage "makhbartak.branding.v1" as the source of truth.
--   * order_ratings — per-order customer rating, one row per (order, customer).
-- Both surfaces stay service-role only on writes; reads are public-read for
-- branding (so guest customers can theme the shell) and customer-self for
-- ratings.
-- ============================================================================

-- ── app_branding ────────────────────────────────────────────────────────────
-- Singleton row keyed on a fixed UUID. The singleton pattern matches
-- app_settings (see migration 019) so admin-touch code stays consistent.
create table if not exists public.app_branding (
  id          uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  config      jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

-- Constrain to the singleton id.
do $$ begin
  alter table public.app_branding
    add constraint app_branding_singleton_check check (id = '00000000-0000-0000-0000-000000000001'::uuid);
exception when duplicate_object then null; end $$;

-- Seed the singleton with the in-app DEFAULT_BRANDING shape on first apply.
-- Picsum URLs match src/lib/branding.ts so post-migration first paint
-- continues to render. Admin-edit lands here via update_app_branding_admin.
insert into public.app_branding (id, config)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object(
    'logos', jsonb_build_object(
      'main',           'https://picsum.photos/seed/makhbartak-logo-main/256/256',
      'header',         'https://picsum.photos/seed/makhbartak-logo-hdr/96/96',
      'mobile',         'https://picsum.photos/seed/makhbartak-logo-m/192/192',
      'desktop',        'https://picsum.photos/seed/makhbartak-logo-d/256/256',
      'light',          'https://picsum.photos/seed/makhbartak-logo-light/192/192',
      'favicon',        '/favicon.ico',
      'pwaIcon',        'https://picsum.photos/seed/makhbartak-pwa/512/512',
      'adminDashboard', 'https://picsum.photos/seed/makhbartak-admin/128/128',
      'nurseInterface', 'https://picsum.photos/seed/makhbartak-nurse/128/128',
      'labPortal',      'https://picsum.photos/seed/makhbartak-lab/128/128'
    ),
    'theme', jsonb_build_object(
      'primary', '#0891B2',
      'cta',     '#059669',
      'accent',  '#ECFEFF'
    ),
    'background', 'soft-mesh'
  )
)
on conflict (id) do nothing;

-- Public-read RLS: every portal (including guests) reads branding so the
-- shell themes correctly. Writes are service-role only via the RPC below.
alter table public.app_branding enable row level security;
do $$ begin
  create policy app_branding_public_read on public.app_branding
    for select using (true);
exception when duplicate_object then null; end $$;

create or replace function public.update_app_branding_admin(
  p_config jsonb,
  p_actor  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.app_branding;
begin
  if p_config is null then
    raise exception 'config is required';
  end if;
  insert into public.app_branding (id, config, updated_by)
  values ('00000000-0000-0000-0000-000000000001'::uuid, p_config, p_actor)
  on conflict (id) do update
    set config     = excluded.config,
        updated_at = now(),
        updated_by = excluded.updated_by
  returning * into v_row;
  return jsonb_build_object(
    'config',     v_row.config,
    'updatedAt',  v_row.updated_at
  );
end;
$$;

-- ── order_ratings ───────────────────────────────────────────────────────────
-- One rating per (order, customer). Customer can submit once; second submit
-- updates in place (the RPC handles the upsert). Stars are 1..5, comment
-- optional. Admin reads via the orders join (no separate admin table).
create table if not exists public.order_ratings (
  id              uuid primary key default uuid_generate_v4(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  nurse_id        uuid     references public.nurses(id) on delete set null,
  lab_id          uuid     references public.labs(id) on delete set null,
  overall_rating  int  not null check (overall_rating between 1 and 5),
  nurse_rating    int      check (nurse_rating between 1 and 5),
  lab_rating      int      check (lab_rating between 1 and 5),
  comment         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (order_id, customer_id)
);
create index if not exists idx_order_ratings_order_id on public.order_ratings(order_id);
create index if not exists idx_order_ratings_customer_id on public.order_ratings(customer_id);
create index if not exists idx_order_ratings_nurse_id on public.order_ratings(nurse_id);
create index if not exists idx_order_ratings_lab_id on public.order_ratings(lab_id);

create trigger trg_order_ratings_updated_at before update on public.order_ratings
  for each row execute function public.tg_set_updated_at();

alter table public.order_ratings enable row level security;
-- Customer-self read; admin reads via service-role.
do $$ begin
  create policy order_ratings_customer_read on public.order_ratings
    for select using (
      exists (
        select 1 from public.customers c
        where c.id = order_ratings.customer_id and c.profile_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

create or replace function public.submit_order_rating_admin(
  p_order_id        uuid,
  p_customer_id     uuid,
  p_overall_rating  int,
  p_nurse_rating    int default null,
  p_lab_rating      int default null,
  p_comment         text default null
)
returns public.order_ratings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders;
  v_row    public.order_ratings;
begin
  if p_order_id is null or p_customer_id is null then
    raise exception 'order_id and customer_id are required';
  end if;
  if p_overall_rating is null or p_overall_rating < 1 or p_overall_rating > 5 then
    raise exception 'overall_rating must be 1..5';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.customer_id is distinct from p_customer_id then
    raise exception 'customer % does not own order %', p_customer_id, p_order_id;
  end if;
  if v_order.status <> 'completed' then
    raise exception 'order % is not completed; cannot rate', p_order_id;
  end if;

  insert into public.order_ratings (
    order_id, customer_id, nurse_id, lab_id,
    overall_rating, nurse_rating, lab_rating, comment
  )
  values (
    p_order_id, p_customer_id, v_order.nurse_id, v_order.lab_id,
    p_overall_rating, p_nurse_rating, p_lab_rating, nullif(trim(coalesce(p_comment, '')), '')
  )
  on conflict (order_id, customer_id) do update
    set overall_rating = excluded.overall_rating,
        nurse_rating   = excluded.nurse_rating,
        lab_rating     = excluded.lab_rating,
        comment        = excluded.comment,
        updated_at     = now()
  returning * into v_row;

  return v_row;
end;
$$;
