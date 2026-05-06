-- ============================================================================
-- 034_online_payments_scaffold.sql
-- Phase 4.3 — Online payments preparation. Stripe-shaped, but the contract
-- is provider-agnostic: every column added here applies equally to a
-- future_provider variant.
--
-- Hard rules preserved:
--   * Currency on the order stays SYP. payments.amount is SYP.
--   * Online charges store the provider-currency snapshot (charged_amount,
--     provider_currency, exchange_rate). Conversion done in the route.
--   * No nurse_wallet_transactions is written for online payments — the
--     nurse never held that cash.
--   * orders.payment_status flips to 'paid' only via the webhook-driven
--     RPC; the create-intent route leaves the row pending.
--   * Webhook is idempotent: payment_provider_events stores the event id
--     and INSERT … ON CONFLICT DO NOTHING short-circuits replays.
-- ============================================================================

-- ── 1) payments columns ────────────────────────────────────────────────────
do $$ begin
  alter table public.payments add column if not exists charged_amount     numeric(14,2);
  alter table public.payments add column if not exists provider_currency  text;
  alter table public.payments add column if not exists exchange_rate      numeric(14,6);
  alter table public.payments add column if not exists provider_metadata  jsonb;
exception when duplicate_column then null; end $$;

comment on column public.payments.amount             is 'Order total in SYP. Authoritative for ledger.';
comment on column public.payments.charged_amount     is 'Amount actually charged on the provider, in provider_currency. NULL for cash.';
comment on column public.payments.provider_currency  is 'Provider-side currency (e.g. USD). NULL for SYP cash.';
comment on column public.payments.exchange_rate      is 'Snapshot of SYP→provider_currency at intent creation. amount * exchange_rate ≈ charged_amount.';
comment on column public.payments.provider_metadata  is 'Free-form jsonb pulled from provider responses (intent id, latest charge, last_payment_error, etc.).';

-- ── 2) Provider event log (webhook idempotency + audit trail) ──────────────
create table if not exists public.payment_provider_events (
  id            text primary key,             -- provider event id (e.g. evt_…)
  payment_id    uuid references public.payments(id) on delete set null,
  provider      text not null,                -- 'stripe' | 'future_provider'
  event_type    text not null,                -- e.g. 'payment_intent.succeeded'
  payload       jsonb not null,
  processed_at  timestamptz not null default now(),
  result        text                           -- short result tag for forensics
);
create index if not exists ppe_payment_idx on public.payment_provider_events(payment_id);
create index if not exists ppe_provider_idx on public.payment_provider_events(provider, event_type);
alter table public.payment_provider_events enable row level security;
-- No policies → service-role only. Customer/admin reads go via API routes.

-- ── 3) Lookup helper used by the webhook to find a payment by provider_ref.
create or replace function public.find_payment_by_provider_ref(p_provider_ref text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from public.payments where provider_ref = p_provider_ref limit 1;
$$;
revoke all on function public.find_payment_by_provider_ref(text) from public, anon, authenticated;

-- ── 4) start_online_payment_admin
-- Called by /api/payments/stripe/create-intent AFTER the route created the
-- PaymentIntent on the provider. Stamps the existing pending payments row
-- with provider + provider_ref + provider-currency snapshot. Idempotent: if
-- the order already has a paid-ish payments row, raises so the route can
-- return 409 to the customer.
create or replace function public.start_online_payment_admin(
  p_order_id          uuid,
  p_customer_id       uuid,
  p_provider          text,
  p_provider_ref      text,
  p_charged_amount    numeric,
  p_provider_currency text,
  p_exchange_rate     numeric,
  p_metadata          jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      public.orders%rowtype;
  v_payment_id uuid;
begin
  if p_order_id is null or p_customer_id is null then
    raise exception 'order id and customer id are required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'الطلب غير موجود' using errcode = 'P0001';
  end if;
  if v_order.customer_id is distinct from p_customer_id then
    raise exception 'الطلب غير مرتبط بهذا العميل' using errcode = 'P0001';
  end if;
  if v_order.payment_method <> 'online' then
    raise exception 'الدفع الإلكتروني متاح للطلبات الإلكترونية فقط' using errcode = 'P0001';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'تم دفع الطلب مسبقاً' using errcode = 'P0001';
  end if;

  update public.payments
     set provider          = p_provider,
         provider_ref      = p_provider_ref,
         charged_amount    = p_charged_amount,
         provider_currency = p_provider_currency,
         exchange_rate     = p_exchange_rate,
         provider_metadata = coalesce(provider_metadata, '{}'::jsonb) ||
                             coalesce(p_metadata, '{}'::jsonb),
         updated_at        = now()
   where order_id = p_order_id and status = 'pending'
   returning id into v_payment_id;

  if v_payment_id is null then
    -- The pending row was missing (legacy data) — recreate it so the
    -- post-Phase-4.1.1 invariant "every order owns a payment row" still
    -- holds. amount stays SYP.
    insert into public.payments (
      order_id, method, amount, currency, status, provider, provider_ref,
      charged_amount, provider_currency, exchange_rate, provider_metadata
    )
    values (
      p_order_id, 'online', coalesce(v_order.total, 0), 'SYP', 'pending',
      p_provider, p_provider_ref,
      p_charged_amount, p_provider_currency, p_exchange_rate,
      coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_payment_id;
  end if;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, note
  )
  values (
    p_order_id, v_order.status, 'customer', null,
    'online_payment:intent_created:' || p_provider || ':' || p_provider_ref
  );

  return v_payment_id;
end;
$$;
revoke all on function public.start_online_payment_admin(uuid, uuid, text, text, numeric, text, numeric, jsonb) from public, anon, authenticated;

-- ── 5) confirm_online_payment_admin
-- Called from the webhook on payment_intent.succeeded. Idempotent. Sets the
-- payment row to verified_by_admin (admin verification is implicit when the
-- provider settles), flips orders.payment_status='paid', writes order
-- history. Does NOT write nurse_wallet_transactions — the nurse never held
-- this cash.
create or replace function public.confirm_online_payment_admin(
  p_payment_id        uuid,
  p_provider          text,
  p_provider_ref      text,
  p_charged_amount    numeric default null,
  p_provider_currency text default null,
  p_metadata          jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay  public.payments%rowtype;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment % does not exist', p_payment_id;
  end if;
  if v_pay.status in ('verified_by_admin', 'paid') then
    -- Already confirmed — webhook replay. Idempotent no-op.
    return;
  end if;
  if v_pay.status not in ('pending', 'paid_by_nurse') then
    raise exception 'cannot confirm payment in status %', v_pay.status;
  end if;

  update public.payments
     set status              = 'verified_by_admin',
         provider            = coalesce(provider, p_provider),
         provider_ref        = coalesce(provider_ref, p_provider_ref),
         charged_amount      = coalesce(p_charged_amount, charged_amount),
         provider_currency   = coalesce(p_provider_currency, provider_currency),
         provider_metadata   = coalesce(provider_metadata, '{}'::jsonb) ||
                               coalesce(p_metadata, '{}'::jsonb),
         paid_at             = coalesce(paid_at, now()),
         verified_at         = coalesce(verified_at, now()),
         updated_at          = now()
   where id = p_payment_id;

  update public.orders
     set payment_status = 'paid', updated_at = now()
   where id = v_pay.order_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, note
  )
  select v_pay.order_id, o.status, 'admin', null,
         'online_payment:confirmed:' || p_provider || ':' || p_provider_ref
    from public.orders o where o.id = v_pay.order_id;
end;
$$;
revoke all on function public.confirm_online_payment_admin(uuid, text, text, numeric, text, jsonb) from public, anon, authenticated;

-- ── 6) mark_online_payment_failed
-- Called from the webhook on payment_intent.payment_failed. Idempotent.
create or replace function public.mark_online_payment_failed(
  p_payment_id uuid,
  p_reason     text default null,
  p_metadata   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then return; end if;
  if v_pay.status in ('verified_by_admin', 'paid', 'refunded', 'partially_refunded') then
    return;
  end if;

  update public.payments
     set status            = 'failed',
         provider_metadata = coalesce(provider_metadata, '{}'::jsonb) ||
                             coalesce(p_metadata, '{}'::jsonb),
         updated_at        = now()
   where id = p_payment_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, note
  )
  select v_pay.order_id, o.status, 'admin', null,
         'online_payment:failed' || coalesce(' — ' || nullif(trim(p_reason), ''), '')
    from public.orders o where o.id = v_pay.order_id;
end;
$$;
revoke all on function public.mark_online_payment_failed(uuid, text, jsonb) from public, anon, authenticated;

-- ── 7) record_provider_refund
-- Webhook handler for charge.refunded. Reconciles a provider-side refund
-- back into our ledger. Mirrors the Phase 4.2 refund flow but does NOT
-- touch nurse wallets (no nurse held the funds). Idempotent on
-- payment_provider_events (caller checks before invoking).
create or replace function public.record_provider_refund(
  p_payment_id uuid,
  p_amount     numeric,
  p_reason     text default null,
  p_metadata   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay      public.payments%rowtype;
  v_remaining numeric(14,2);
  v_take     numeric(14,2);
  v_total    numeric(14,2);
  v_status   public.payment_status;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then return; end if;
  if v_pay.status not in ('paid', 'paid_by_nurse', 'verified_by_admin', 'partially_refunded') then
    return;
  end if;

  v_remaining := coalesce(v_pay.amount, 0) - coalesce(v_pay.refunded_amount, 0);
  if v_remaining <= 0 then return; end if;

  v_take  := least(coalesce(p_amount, v_remaining), v_remaining);
  v_total := coalesce(v_pay.refunded_amount, 0) + v_take;
  v_status := case when v_total >= v_pay.amount
                   then 'refunded'::public.payment_status
                   else 'partially_refunded'::public.payment_status end;

  update public.payments
     set refunded_amount   = v_total,
         refund_reason     = coalesce(refund_reason || E'\n', '') || coalesce(trim(p_reason), 'provider refund'),
         status            = v_status,
         refunded_at       = now(),
         provider_metadata = coalesce(provider_metadata, '{}'::jsonb) ||
                             coalesce(p_metadata, '{}'::jsonb),
         updated_at        = now()
   where id = p_payment_id;

  if v_status = 'refunded' then
    update public.orders
       set payment_status = 'refunded', updated_at = now()
     where id = v_pay.order_id;
  end if;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, note
  )
  select v_pay.order_id, o.status, 'admin', null,
         'online_payment:refunded:' || v_take::text
           || coalesce(' — ' || nullif(trim(p_reason), ''), '')
    from public.orders o where o.id = v_pay.order_id;
end;
$$;
revoke all on function public.record_provider_refund(uuid, numeric, text, jsonb) from public, anon, authenticated;
