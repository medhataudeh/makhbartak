-- ============================================================================
-- 031_finance_core.sql
-- Phase 4.1 — Core Finance System (cash collection + nurse wallets + commission +
-- per-nurse settlements). Money is auditable: every nurse-side cash event lands
-- in (a) public.payments — granular per-collection record — AND (b)
-- public.nurse_wallet_transactions — running ledger per nurse. Commission is
-- accrued idempotently when orders.status flips to 'completed'. Per-nurse
-- settlements (admin pays the nurse) are a separate transaction type.
--
-- Notes on existing schema we build on top of:
--   * public.payments already exists (002_init_tables.sql:553). We add the
--     nurse + admin verifier + collected_at columns and keep the legacy ones.
--   * public.settlements is the LAB settlements table (002:575). The new
--     per-nurse settlement records live in nurse_wallet_transactions of type
--     'settlement_paid' — separate ledger, no schema clash.
--   * The strict payment gate (mig 029) already refuses sample_collected+
--     until payment_status='paid'. nurse_collect_cash flips the row to paid
--     so the gate releases.
-- ============================================================================

-- ── Extend payments ────────────────────────────────────────────────────────
do $$ begin
  alter table public.payments add column if not exists collected_by_nurse_id  uuid references public.nurses(id)   on delete set null;
  alter table public.payments add column if not exists collected_at           timestamptz;
  alter table public.payments add column if not exists verified_by_admin_id   uuid references public.profiles(id) on delete set null;
  alter table public.payments add column if not exists verified_at            timestamptz;
exception when duplicate_column then null; end $$;

create index if not exists payments_order_id_idx       on public.payments(order_id);
create index if not exists payments_status_idx         on public.payments(status);
create index if not exists payments_collected_nurse_idx on public.payments(collected_by_nurse_id) where collected_by_nurse_id is not null;
create index if not exists payments_collected_at_idx   on public.payments(collected_at desc) where collected_at is not null;

-- Money flow assumes a single canonical paid payment row per order. Two cash
-- collections for the same order is the bug `nurse_collect_cash` exists to
-- prevent. The unique partial index is a backstop in case the RPC is bypassed.
create unique index if not exists payments_one_paid_per_order
  on public.payments(order_id) where status = 'paid';

-- ── App-settings: commission percentage ────────────────────────────────────
do $$ begin
  alter table public.app_settings
    add column if not exists nurse_commission_percentage numeric(5,2) not null default 0
    check (nurse_commission_percentage >= 0 and nurse_commission_percentage <= 100);
exception when duplicate_column then null; end $$;

-- Extend the settings update RPC to accept the new key.
create or replace function public.update_app_settings_admin(p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.app_settings
     set min_booking_notice_minutes = coalesce((p_patch->>'min_booking_notice_minutes')::int,         min_booking_notice_minutes),
         morning_shift_start        = coalesce(p_patch->>'morning_shift_start',                      morning_shift_start),
         morning_shift_end          = coalesce(p_patch->>'morning_shift_end',                        morning_shift_end),
         evening_shift_start        = coalesce(p_patch->>'evening_shift_start',                      evening_shift_start),
         evening_shift_end          = coalesce(p_patch->>'evening_shift_end',                        evening_shift_end),
         supported_cities           = coalesce(
                                        case when p_patch ? 'supported_cities'
                                             then array(select jsonb_array_elements_text(p_patch->'supported_cities'))
                                             else null end,
                                        supported_cities),
         whatsapp_number            = coalesce(p_patch->>'whatsapp_number',                          whatsapp_number),
         allow_cash_orders          = coalesce((p_patch->>'allow_cash_orders')::boolean,             allow_cash_orders),
         booking_horizon_days       = coalesce((p_patch->>'booking_horizon_days')::int,              booking_horizon_days),
         max_orders_per_shift       = coalesce((p_patch->>'max_orders_per_shift')::int,              max_orders_per_shift),
         enable_stripe              = coalesce((p_patch->>'enable_stripe')::boolean,                 enable_stripe),
         stripe_public_key          = coalesce(p_patch->>'stripe_public_key',                        stripe_public_key),
         stripe_mode                = coalesce(p_patch->>'stripe_mode',                              stripe_mode),
         nurse_commission_percentage = coalesce((p_patch->>'nurse_commission_percentage')::numeric,  nurse_commission_percentage),
         updated_at                 = now()
   where id = 1;
end;
$$;

revoke all on function public.update_app_settings_admin(jsonb) from public, anon, authenticated;

-- ── Nurse wallets ──────────────────────────────────────────────────────────
create table if not exists public.nurse_wallets (
  id          uuid primary key default uuid_generate_v4(),
  nurse_id    uuid not null unique references public.nurses(id) on delete cascade,
  balance     numeric(14,2) not null default 0,
  currency    text not null default 'SYP',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_nurse_wallets_updated_at before update on public.nurse_wallets
  for each row execute function public.tg_set_updated_at();

-- ── Nurse wallet transactions (ledger) ─────────────────────────────────────
do $$ begin
  create type public.nurse_wallet_txn_type as enum (
    'cash_collected',
    'commission_earned',
    'settlement_paid',
    'adjustment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.nurse_wallet_txn_direction as enum ('credit', 'debit');
exception when duplicate_object then null; end $$;

create table if not exists public.nurse_wallet_transactions (
  id              uuid primary key default uuid_generate_v4(),
  nurse_id        uuid not null references public.nurses(id) on delete cascade,
  order_id        uuid     references public.orders(id)  on delete set null,
  payment_id      uuid     references public.payments(id) on delete set null,
  type            public.nurse_wallet_txn_type      not null,
  direction       public.nurse_wallet_txn_direction not null,
  amount          numeric(14,2) not null check (amount > 0),
  currency        text not null default 'SYP',
  description_ar  text not null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists nwt_nurse_idx       on public.nurse_wallet_transactions(nurse_id, created_at desc);
create index if not exists nwt_order_idx       on public.nurse_wallet_transactions(order_id) where order_id is not null;
create index if not exists nwt_type_idx        on public.nurse_wallet_transactions(type);

-- Idempotency guards: at most one cash_collected and one commission_earned
-- per order. Both prevent double-credit on accidental retry.
create unique index if not exists nwt_unique_cash_per_order
  on public.nurse_wallet_transactions(order_id)
  where type = 'cash_collected' and order_id is not null;
create unique index if not exists nwt_unique_commission_per_order
  on public.nurse_wallet_transactions(order_id)
  where type = 'commission_earned' and order_id is not null;

-- RLS: service-role only. Every read/write goes through API routes.
alter table public.nurse_wallets               enable row level security;
alter table public.nurse_wallet_transactions   enable row level security;

-- ── Helper: ensure_nurse_wallet ────────────────────────────────────────────
create or replace function public.ensure_nurse_wallet(p_nurse_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.nurse_wallets(nurse_id) values (p_nurse_id)
    on conflict (nurse_id) do nothing;
  select id into v_id from public.nurse_wallets where nurse_id = p_nurse_id;
  return v_id;
end;
$$;

revoke all on function public.ensure_nurse_wallet(uuid) from public, anon, authenticated;

-- ── RPC: nurse_collect_cash ────────────────────────────────────────────────
-- Atomic cash-collection. Checks ownership + arrived state + non-duplicate,
-- then writes the canonical paid payment row, flips orders.payment_status,
-- credits the nurse wallet, and logs an order_status_history note. The Arabic
-- error messages are surfaced verbatim to the nurse UI.
create or replace function public.nurse_collect_cash(
  p_order_id    uuid,
  p_nurse_id    uuid,
  p_actor_id    uuid,
  p_actor_name  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order        public.orders%rowtype;
  v_payment_id   uuid;
  v_amount       numeric(14,2);
begin
  if p_order_id is null or p_nurse_id is null then
    raise exception 'order id and nurse id are required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'الطلب غير موجود' using errcode = 'P0001';
  end if;

  if v_order.nurse_id is distinct from p_nurse_id then
    raise exception 'هذا الطلب غير مخصص لك' using errcode = 'P0001';
  end if;

  if v_order.payment_method <> 'cash' then
    raise exception 'تأكيد التحصيل متاح للطلبات النقدية فقط' using errcode = 'P0001';
  end if;

  if v_order.payment_status = 'paid' then
    raise exception 'تم تحصيل المبلغ مسبقاً' using errcode = 'P0001';
  end if;

  -- Must be at least at "arrived". Earlier states (assigned, nurse_on_way)
  -- mean the nurse is not on-site yet.
  if v_order.status not in ('arrived', 'sample_collected') then
    raise exception 'يجب تأكيد الوصول أولاً' using errcode = 'P0001';
  end if;

  v_amount := coalesce(v_order.total, 0);
  if v_amount <= 0 then
    raise exception 'قيمة الطلب غير صالحة' using errcode = 'P0001';
  end if;

  perform public.ensure_nurse_wallet(p_nurse_id);

  insert into public.payments (
    order_id, method, amount, currency, status, provider,
    paid_at, collected_by_nurse_id, collected_at
  )
  values (
    p_order_id, 'cash', v_amount, 'SYP', 'paid', 'cash',
    now(), p_nurse_id, now()
  )
  returning id into v_payment_id;

  update public.orders
     set payment_status = 'paid',
         updated_at     = now()
   where id = p_order_id;

  insert into public.nurse_wallet_transactions (
    nurse_id, order_id, payment_id, type, direction, amount, currency,
    description_ar, created_by
  )
  values (
    p_nurse_id, p_order_id, v_payment_id, 'cash_collected', 'credit', v_amount, 'SYP',
    'تحصيل نقدي للطلب ' || coalesce(v_order.public_number, p_order_id::text),
    p_actor_id
  );

  update public.nurse_wallets
     set balance    = balance + v_amount,
         updated_at = now()
   where nurse_id = p_nurse_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_order.status, 'nurse', p_actor_id, p_actor_name,
    'تحصيل نقدي: ' || v_amount::text || ' ل.س'
  );

  return jsonb_build_object(
    'order_id',     p_order_id,
    'payment_id',   v_payment_id,
    'amount',       v_amount,
    'paid_at',      now()
  );
end;
$$;

revoke all on function public.nurse_collect_cash(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ── RPC: accrue_nurse_commission ───────────────────────────────────────────
-- Idempotent. Called from trg_orders_accrue_commission when orders.status
-- flips to 'completed'. Skips if no nurse, no commission rate, or a
-- 'commission_earned' txn already exists for this order.
create or replace function public.accrue_nurse_commission(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nurse_id   uuid;
  v_total      numeric(14,2);
  v_rate       numeric(5,2);
  v_commission numeric(14,2);
  v_public     text;
begin
  select nurse_id, total, public_number
    into v_nurse_id, v_total, v_public
    from public.orders where id = p_order_id;

  if v_nurse_id is null or v_total is null or v_total <= 0 then
    return;
  end if;

  -- Already accrued — bail out.
  if exists (
    select 1 from public.nurse_wallet_transactions
     where order_id = p_order_id and type = 'commission_earned'
  ) then
    return;
  end if;

  select coalesce(nurse_commission_percentage, 0)
    into v_rate from public.app_settings where id = 1;
  if v_rate is null or v_rate <= 0 then
    return;
  end if;

  v_commission := round(v_total * v_rate / 100.0, 2);
  if v_commission <= 0 then
    return;
  end if;

  perform public.ensure_nurse_wallet(v_nurse_id);

  insert into public.nurse_wallet_transactions (
    nurse_id, order_id, type, direction, amount, currency, description_ar
  )
  values (
    v_nurse_id, p_order_id, 'commission_earned', 'debit', v_commission, 'SYP',
    'عمولة الطلب ' || coalesce(v_public, p_order_id::text)
  );

  -- Commission is the platform's share *out* of the cash the nurse is
  -- holding, so wallet balance decreases.
  update public.nurse_wallets
     set balance    = balance - v_commission,
         updated_at = now()
   where nurse_id = v_nurse_id;
end;
$$;

revoke all on function public.accrue_nurse_commission(uuid) from public, anon, authenticated;

-- Trigger: accrue on completion. Idempotent on retries because the inner
-- function checks for an existing commission_earned txn.
create or replace function public.tg_orders_accrue_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    perform public.accrue_nurse_commission(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_accrue_commission on public.orders;
create trigger trg_orders_accrue_commission
  after update of status on public.orders
  for each row execute function public.tg_orders_accrue_commission();

-- ── RPC: record_nurse_settlement_admin ─────────────────────────────────────
-- Admin "paid X to nurse Y". Refuses negative or non-finite amounts. Allows
-- exceeding net_due only when p_force_adjustment = true (creates an
-- 'adjustment' txn instead of 'settlement_paid' to make the audit trail
-- explicit).
create or replace function public.record_nurse_settlement_admin(
  p_nurse_id          uuid,
  p_amount            numeric,
  p_admin_id          uuid,
  p_note              text default null,
  p_force_adjustment  boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance  numeric(14,2);
  v_txn_id   uuid;
begin
  if p_nurse_id is null then raise exception 'p_nurse_id is required'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'المبلغ يجب أن يكون أكبر من صفر' using errcode = 'P0001';
  end if;

  perform public.ensure_nurse_wallet(p_nurse_id);
  select balance into v_balance from public.nurse_wallets where nurse_id = p_nurse_id;

  -- Balance is "cash the nurse owes us" (positive) minus "what we paid back".
  -- A settlement decreases the balance by p_amount. If the result would go
  -- negative we refuse unless caller passes p_force_adjustment.
  if v_balance - p_amount < 0 and not p_force_adjustment then
    raise exception 'المبلغ يتجاوز الرصيد المستحق على الممرض' using errcode = 'P0001';
  end if;

  insert into public.nurse_wallet_transactions (
    nurse_id, type, direction, amount, currency, description_ar, created_by
  )
  values (
    p_nurse_id,
    case when p_force_adjustment then 'adjustment'::public.nurse_wallet_txn_type
         else 'settlement_paid'::public.nurse_wallet_txn_type end,
    'debit', p_amount, 'SYP',
    coalesce(p_note, 'تسوية مالية'),
    p_admin_id
  )
  returning id into v_txn_id;

  update public.nurse_wallets
     set balance    = balance - p_amount,
         updated_at = now()
   where nurse_id = p_nurse_id;

  return v_txn_id;
end;
$$;

revoke all on function public.record_nurse_settlement_admin(uuid, numeric, uuid, text, boolean) from public, anon, authenticated;

-- ── View: per-nurse aggregates for the admin Finance dashboard ─────────────
create or replace view public.nurse_finance_summary as
select
  n.id                                                       as nurse_id,
  p.full_name                                                as nurse_name,
  coalesce(w.balance, 0)                                     as net_due,
  coalesce(sum(t.amount) filter (where t.type = 'cash_collected'),     0)   as total_collected,
  coalesce(sum(t.amount) filter (where t.type = 'commission_earned'),  0)   as total_commission,
  coalesce(sum(t.amount) filter (where t.type = 'settlement_paid'),    0)   as total_settled,
  coalesce(sum(t.amount) filter (where t.type = 'adjustment'),         0)   as total_adjustments
from public.nurses n
left join public.profiles  p on p.id = n.profile_id
left join public.nurse_wallets w on w.nurse_id = n.id
left join public.nurse_wallet_transactions t on t.nurse_id = n.id
where n.deleted_at is null
group by n.id, p.full_name, w.balance;

revoke all on public.nurse_finance_summary from public, anon, authenticated;
