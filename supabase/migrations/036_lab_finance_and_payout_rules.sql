-- ============================================================================
-- 036_lab_finance_and_payout_rules.sql
-- Phase 5.2 — Lab finance engine.
--
-- Adds:
--   * lab_wallets (mirror of nurse_wallets)
--   * lab_wallet_transactions (ledger; types: earning, settlement_paid, adjustment)
--   * lab_payout_rules (test-specific OR lab-default; payout_type=fixed|percentage)
--   * app_settings.lab_default_payout_type/value (global fallback)
--   * resolve_lab_payout(p_lab_id, p_lab_test_id) — returns the effective rule
--     respecting priority: test-specific > lab-default > global fallback.
--   * accrue_lab_earning(p_order_id) — idempotent; iterates order_items,
--     calculates per-test earning, writes ONE earning row per order.
--   * record_lab_settlement_admin(p_lab_id, p_admin_id, p_amount, p_note)
--   * lab_finance_summary view
--   * Trigger extension: tg_orders_accrue_payouts also fires accrue_lab_earning.
--
-- Backward-compat note:
--   * The legacy lab_price_agreements table is left in place. Reads still work
--     for the existing Settlements feature. The new earnings ledger reads
--     from lab_payout_rules only. To migrate existing pricing, an admin can
--     copy each agreement into a fixed-type rule.
-- ============================================================================

-- ── 1) Wallets + ledger ────────────────────────────────────────────────────
create table if not exists public.lab_wallets (
  id          uuid primary key default uuid_generate_v4(),
  lab_id      uuid not null unique references public.labs(id) on delete cascade,
  balance     numeric(14,2) not null default 0,
  currency    text not null default 'SYP',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_lab_wallets_updated_at before update on public.lab_wallets
  for each row execute function public.tg_set_updated_at();

do $$ begin
  create type public.lab_wallet_txn_type as enum (
    'earning',
    'settlement_paid',
    'adjustment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lab_wallet_txn_direction as enum ('credit', 'debit');
exception when duplicate_object then null; end $$;

create table if not exists public.lab_wallet_transactions (
  id              uuid primary key default uuid_generate_v4(),
  lab_id          uuid not null references public.labs(id) on delete cascade,
  order_id        uuid     references public.orders(id) on delete set null,
  type            public.lab_wallet_txn_type      not null,
  direction       public.lab_wallet_txn_direction not null,
  amount          numeric(14,2) not null check (amount > 0),
  currency        text not null default 'SYP',
  description_ar  text not null,
  payout_snapshot jsonb,                              -- per-item breakdown for audit
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists lwt_lab_idx   on public.lab_wallet_transactions(lab_id, created_at desc);
create index if not exists lwt_order_idx on public.lab_wallet_transactions(order_id) where order_id is not null;
create index if not exists lwt_type_idx  on public.lab_wallet_transactions(type);

-- Idempotency: at most one earning per order. The trigger / RPC re-checks
-- before insert; this is the backstop in case of a future direct write.
create unique index if not exists lwt_unique_earning_per_order
  on public.lab_wallet_transactions(order_id)
  where type = 'earning' and order_id is not null;

alter table public.lab_wallets             enable row level security;
alter table public.lab_wallet_transactions enable row level security;

-- Helper: get-or-create wallet row.
create or replace function public.ensure_lab_wallet(p_lab_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.lab_wallets(lab_id) values (p_lab_id)
    on conflict (lab_id) do nothing;
  select id into v_id from public.lab_wallets where lab_id = p_lab_id;
  return v_id;
end;
$$;
revoke all on function public.ensure_lab_wallet(uuid) from public, anon, authenticated;

-- ── 2) Payout rules ───────────────────────────────────────────────────────
do $$ begin
  create type public.payout_type as enum ('fixed', 'percentage');
exception when duplicate_object then null; end $$;

create table if not exists public.lab_payout_rules (
  id            uuid primary key default uuid_generate_v4(),
  lab_id        uuid     references public.labs(id)      on delete cascade,
  lab_test_id   uuid     references public.lab_tests(id) on delete cascade,
  payout_type   public.payout_type not null,
  payout_value  numeric(14,2) not null check (payout_value >= 0),
  is_active     boolean not null default true,
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_lab_payout_rules_updated_at before update on public.lab_payout_rules
  for each row execute function public.tg_set_updated_at();

-- One specific rule per (lab, test). NULL test_id is the lab-default rule;
-- only one of those per lab.
create unique index if not exists lab_payout_rules_specific
  on public.lab_payout_rules(lab_id, lab_test_id)
  where lab_id is not null and lab_test_id is not null;
create unique index if not exists lab_payout_rules_lab_default
  on public.lab_payout_rules(lab_id)
  where lab_id is not null and lab_test_id is null;

alter table public.lab_payout_rules enable row level security;

-- Global fallback lives on app_settings. Default 60% so behavior matches
-- the legacy frontend computeOrderLabAmount rule.
do $$ begin
  alter table public.app_settings
    add column if not exists lab_default_payout_type  public.payout_type not null default 'percentage',
    add column if not exists lab_default_payout_value numeric(14,2) not null default 60
      check (lab_default_payout_value >= 0);
exception when duplicate_column then null; end $$;

-- Surface the new keys in update_app_settings_admin so the admin UI can
-- write them. We keep all existing keys forwarded.
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
         lab_default_payout_type    = coalesce((p_patch->>'lab_default_payout_type')::public.payout_type, lab_default_payout_type),
         lab_default_payout_value   = coalesce((p_patch->>'lab_default_payout_value')::numeric,      lab_default_payout_value),
         updated_at                 = now()
   where id = 1;
end;
$$;
revoke all on function public.update_app_settings_admin(jsonb) from public, anon, authenticated;

-- ── 3) Resolve effective payout for a (lab, test) pair ────────────────────
create or replace function public.resolve_lab_payout(
  p_lab_id      uuid,
  p_lab_test_id uuid
)
returns table(payout_type public.payout_type, payout_value numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type  public.payout_type;
  v_value numeric(14,2);
begin
  -- 1) Test-specific.
  select r.payout_type, r.payout_value
    into v_type, v_value
    from public.lab_payout_rules r
   where r.lab_id = p_lab_id
     and r.lab_test_id = p_lab_test_id
     and r.is_active
   limit 1;
  if v_type is not null then
    payout_type := v_type; payout_value := v_value; return next; return;
  end if;

  -- 2) Lab default.
  select r.payout_type, r.payout_value
    into v_type, v_value
    from public.lab_payout_rules r
   where r.lab_id = p_lab_id
     and r.lab_test_id is null
     and r.is_active
   limit 1;
  if v_type is not null then
    payout_type := v_type; payout_value := v_value; return next; return;
  end if;

  -- 3) Global fallback from app_settings.
  select s.lab_default_payout_type, s.lab_default_payout_value
    into v_type, v_value
    from public.app_settings s where s.id = 1;
  payout_type := coalesce(v_type, 'percentage'::public.payout_type);
  payout_value := coalesce(v_value, 60);
  return next;
end;
$$;
revoke all on function public.resolve_lab_payout(uuid, uuid) from public, anon, authenticated;

-- ── 4) Accrue lab earning on order completion ─────────────────────────────
-- Idempotent: returns silently if order is missing a lab, total <= 0, or an
-- 'earning' txn already exists.
create or replace function public.accrue_lab_earning(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lab_id    uuid;
  v_status    public.order_status;
  v_pay_st    public.payment_status;
  v_public    text;
  v_total     numeric(14,2);
  v_item      record;
  v_per_item  numeric(14,2);
  v_sum       numeric(14,2) := 0;
  v_ptype     public.payout_type;
  v_pvalue    numeric(14,2);
  v_breakdown jsonb := '[]'::jsonb;
begin
  select lab_id, status, payment_status, public_number, total
    into v_lab_id, v_status, v_pay_st, v_public, v_total
    from public.orders where id = p_order_id;

  if v_lab_id is null or v_status <> 'completed' or coalesce(v_total, 0) <= 0 then
    return;
  end if;
  -- Lab earning is recognised only on paid orders. Mirrors the nurse
  -- commission gate so unpaid force-completes don't accrue.
  if v_pay_st is distinct from 'paid' then
    return;
  end if;

  if exists (
    select 1 from public.lab_wallet_transactions
     where order_id = p_order_id and type = 'earning'
  ) then
    return;
  end if;

  for v_item in
    select id, lab_test_id, name_ar_snapshot, price_snapshot
      from public.order_items where order_id = p_order_id
  loop
    select payout_type, payout_value
      into v_ptype, v_pvalue
      from public.resolve_lab_payout(v_lab_id, v_item.lab_test_id);

    if v_ptype = 'fixed' then
      v_per_item := round(coalesce(v_pvalue, 0), 2);
    else
      v_per_item := round(coalesce(v_item.price_snapshot, 0) * coalesce(v_pvalue, 0) / 100.0, 2);
    end if;
    v_sum := v_sum + v_per_item;
    v_breakdown := v_breakdown || jsonb_build_object(
      'item_id',     v_item.id,
      'name_ar',     v_item.name_ar_snapshot,
      'lab_test_id', v_item.lab_test_id,
      'price',       v_item.price_snapshot,
      'payout_type', v_ptype,
      'payout_value', v_pvalue,
      'earning',     v_per_item
    );
  end loop;

  if v_sum <= 0 then
    return;
  end if;

  perform public.ensure_lab_wallet(v_lab_id);

  insert into public.lab_wallet_transactions (
    lab_id, order_id, type, direction, amount, currency,
    description_ar, payout_snapshot
  )
  values (
    v_lab_id, p_order_id, 'earning', 'credit', v_sum, 'SYP',
    'مستحقات الطلب ' || coalesce(v_public, p_order_id::text),
    v_breakdown
  );

  update public.lab_wallets
     set balance = balance + v_sum, updated_at = now()
   where lab_id = v_lab_id;
end;
$$;
revoke all on function public.accrue_lab_earning(uuid) from public, anon, authenticated;

-- ── 5) Trigger: extend the existing accrue-on-completed trigger to also
--      run accrue_lab_earning. Keeps the nurse commission path unchanged.
create or replace function public.tg_orders_accrue_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    perform public.accrue_nurse_commission(new.id);
    perform public.accrue_lab_earning(new.id);
  end if;
  return new;
end;
$$;
-- Trigger row itself was created in mig 031; the function body update is
-- sufficient.

-- ── 6) Settlement RPC for labs ────────────────────────────────────────────
create or replace function public.record_lab_settlement_admin(
  p_lab_id     uuid,
  p_amount     numeric,
  p_admin_id   uuid,
  p_note       text default null,
  p_force_adjustment boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,2);
  v_txn_id  uuid;
begin
  if p_lab_id is null then raise exception 'p_lab_id is required'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'المبلغ يجب أن يكون أكبر من صفر' using errcode = 'P0001';
  end if;

  -- Verify the lab exists and is not soft-deleted.
  if not exists (select 1 from public.labs where id = p_lab_id and deleted_at is null) then
    raise exception 'المختبر غير موجود' using errcode = 'P0001';
  end if;

  perform public.ensure_lab_wallet(p_lab_id);
  select balance into v_balance from public.lab_wallets where lab_id = p_lab_id;

  -- Lab balance is "what platform owes the lab" (positive). Settlement
  -- decreases it. Refuse overflow unless caller explicitly forces adjustment.
  if v_balance - p_amount < 0 and not p_force_adjustment then
    raise exception 'المبلغ يتجاوز المستحق على المنصة' using errcode = 'P0001';
  end if;

  insert into public.lab_wallet_transactions (
    lab_id, type, direction, amount, currency, description_ar, created_by
  )
  values (
    p_lab_id,
    case when p_force_adjustment then 'adjustment'::public.lab_wallet_txn_type
         else 'settlement_paid'::public.lab_wallet_txn_type end,
    'debit', p_amount, 'SYP',
    coalesce(nullif(trim(p_note), ''), 'تسوية مالية'),
    p_admin_id
  )
  returning id into v_txn_id;

  update public.lab_wallets
     set balance = balance - p_amount, updated_at = now()
   where lab_id = p_lab_id;

  return v_txn_id;
end;
$$;
revoke all on function public.record_lab_settlement_admin(uuid, numeric, uuid, text, boolean) from public, anon, authenticated;

-- ── 7) Per-lab summary view ───────────────────────────────────────────────
create or replace view public.lab_finance_summary as
select
  l.id                                                                             as lab_id,
  l.name_ar                                                                        as lab_name,
  coalesce(w.balance, 0)                                                           as net_due,
  coalesce(sum(t.amount) filter (where t.type = 'earning'),         0)             as total_earnings,
  coalesce(sum(t.amount) filter (where t.type = 'settlement_paid'), 0)             as total_settled,
  coalesce(sum(t.amount) filter (where t.type = 'adjustment'),      0)             as total_adjustments,
  coalesce(count(*) filter (where t.type = 'earning'), 0)                          as completed_orders,
  case when count(*) filter (where t.type = 'earning') > 0
       then coalesce(sum(t.amount) filter (where t.type = 'earning'), 0)
            / count(*) filter (where t.type = 'earning')
       else 0 end                                                                  as avg_earning_per_order
from public.labs l
left join public.lab_wallets w on w.lab_id = l.id
left join public.lab_wallet_transactions t on t.lab_id = l.id
where l.deleted_at is null
group by l.id, l.name_ar, w.balance;

revoke all on public.lab_finance_summary from public, anon, authenticated;
