-- ============================================================================
-- 033_finance_phase42.sql
-- Phase 4.2 — Financial Control & Reporting Layer.
--
-- Adds:
--   * Granular payment statuses: paid_by_nurse, verified_by_admin,
--     partially_refunded.
--   * Partial-refund tracking on payments (refunded_amount, refund_reason).
--   * verify_payment_admin RPC (admin verifies a nurse-collected payment).
--   * refund_payment_admin RPC (full or partial refund with audit trail).
--   * New nurse_wallet_transactions type 'refund' (debit).
--
-- Invariants preserved:
--   * orders.payment_status='paid' is set whenever ANY collection happens
--     (nurse or admin) so the strict gate (mig 029) keeps working.
--   * payments.status carries the granular value: pending → paid_by_nurse →
--     verified_by_admin (or refunded / partially_refunded).
--   * Existing 'paid' rows from before this migration remain valid; every
--     "paid-ish" predicate uses the broader IN list.
-- ============================================================================

-- ── 1) Enum extensions. ALTER TYPE ADD VALUE IF NOT EXISTS is idempotent.
--      Cannot run inside a transaction block on older Postgres; Supabase's
--      migration runner handles this.
alter type public.payment_status add value if not exists 'paid_by_nurse';
alter type public.payment_status add value if not exists 'verified_by_admin';
alter type public.payment_status add value if not exists 'partially_refunded';

-- New ledger type for the explicit refund flow. cash_refund (mig 032) stays
-- as the cancel-driven reversal type; refund is the admin-initiated refund.
alter type public.nurse_wallet_txn_type add value if not exists 'refund';

-- ── 2) Partial-refund columns on payments.
do $$ begin
  alter table public.payments add column if not exists refunded_amount numeric(14,2) not null default 0;
  alter table public.payments add column if not exists refund_reason   text;
exception when duplicate_column then null; end $$;

-- ── 3) Refresh the unique partial index. The "one paid row per order"
--      guarantee now applies to the broader paid-ish set.
drop index if exists public.payments_one_paid_per_order;
create unique index if not exists payments_one_paid_per_order
  on public.payments(order_id)
  where status in ('paid', 'paid_by_nurse', 'verified_by_admin', 'partially_refunded');

-- ── 4) nurse_collect_cash: new payment status is paid_by_nurse.
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
  if v_order.status not in ('arrived', 'sample_collected') then
    raise exception 'يجب تأكيد الوصول أولاً' using errcode = 'P0001';
  end if;

  v_amount := coalesce(v_order.total, 0);
  if v_amount <= 0 then
    raise exception 'قيمة الطلب غير صالحة' using errcode = 'P0001';
  end if;

  perform public.ensure_nurse_wallet(p_nurse_id);

  update public.payments
     set status = 'paid_by_nurse', amount = v_amount, currency = 'SYP',
         provider = 'cash', method = 'cash', paid_at = now(),
         collected_by_nurse_id = p_nurse_id, collected_at = now(),
         updated_at = now()
   where order_id = p_order_id and status = 'pending'
   returning id into v_payment_id;

  if v_payment_id is null then
    insert into public.payments (
      order_id, method, amount, currency, status, provider,
      paid_at, collected_by_nurse_id, collected_at
    )
    values (
      p_order_id, 'cash', v_amount, 'SYP', 'paid_by_nurse', 'cash',
      now(), p_nurse_id, now()
    )
    returning id into v_payment_id;
  end if;

  update public.orders
     set payment_status = 'paid', updated_at = now()
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
     set balance = balance + v_amount, updated_at = now()
   where nurse_id = p_nurse_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_order.status, 'nurse', p_actor_id, p_actor_name,
    'تحصيل نقدي: ' || v_amount::text || ' ل.س'
  );

  return jsonb_build_object(
    'order_id',   p_order_id,
    'payment_id', v_payment_id,
    'amount',     v_amount,
    'paid_at',    now()
  );
end;
$$;

revoke all on function public.nurse_collect_cash(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ── 5) admin_record_cash_payment: admin-recorded cash now verified by
--      definition (admin is the one writing it). Goes straight to
--      verified_by_admin.
create or replace function public.admin_record_cash_payment(
  p_order_id    uuid,
  p_admin_id    uuid,
  p_admin_name  text default null,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      public.orders%rowtype;
  v_payment_id uuid;
  v_amount     numeric(14,2);
begin
  if p_order_id is null then
    raise exception 'order id is required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'الطلب غير موجود' using errcode = 'P0001';
  end if;
  if v_order.payment_method <> 'cash' then
    raise exception 'تسجيل الدفع النقدي متاح للطلبات النقدية فقط' using errcode = 'P0001';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'تم تحصيل المبلغ مسبقاً' using errcode = 'P0001';
  end if;

  v_amount := coalesce(v_order.total, 0);
  if v_amount <= 0 then
    raise exception 'قيمة الطلب غير صالحة' using errcode = 'P0001';
  end if;

  update public.payments
     set status = 'verified_by_admin', amount = v_amount, currency = 'SYP',
         provider = 'cash', method = 'cash', paid_at = now(),
         verified_by_admin_id = p_admin_id, verified_at = now(),
         updated_at = now()
   where order_id = p_order_id and status = 'pending'
   returning id into v_payment_id;

  if v_payment_id is null then
    insert into public.payments (
      order_id, method, amount, currency, status, provider,
      paid_at, verified_by_admin_id, verified_at
    )
    values (
      p_order_id, 'cash', v_amount, 'SYP', 'verified_by_admin', 'cash',
      now(), p_admin_id, now()
    )
    returning id into v_payment_id;
  end if;

  update public.orders
     set payment_status = 'paid', updated_at = now()
   where id = p_order_id;

  if v_order.nurse_id is not null then
    perform public.ensure_nurse_wallet(v_order.nurse_id);
    insert into public.nurse_wallet_transactions (
      nurse_id, order_id, payment_id, type, direction, amount, currency,
      description_ar, created_by
    )
    values (
      v_order.nurse_id, p_order_id, v_payment_id, 'cash_collected', 'credit', v_amount, 'SYP',
      'تحصيل نقدي (عبر الإدارة) للطلب ' || coalesce(v_order.public_number, p_order_id::text),
      p_admin_id
    );
    update public.nurse_wallets
       set balance = balance + v_amount, updated_at = now()
     where nurse_id = v_order.nurse_id;
  end if;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_order.status, 'admin', p_admin_id, p_admin_name,
    coalesce(nullif(trim(p_note), ''), 'تسجيل تحصيل نقدي عبر الإدارة')
      || ' — ' || v_amount::text || ' ل.س'
  );

  return jsonb_build_object(
    'order_id',   p_order_id,
    'payment_id', v_payment_id,
    'amount',     v_amount,
    'paid_at',    now()
  );
end;
$$;

revoke all on function public.admin_record_cash_payment(uuid, uuid, text, text) from public, anon, authenticated;

-- ── 6) verify_payment_admin: admin upgrades paid_by_nurse → verified_by_admin.
create or replace function public.verify_payment_admin(
  p_payment_id  uuid,
  p_admin_id    uuid,
  p_admin_name  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay  public.payments%rowtype;
begin
  if p_payment_id is null then
    raise exception 'payment id is required';
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'الدفعة غير موجودة' using errcode = 'P0001';
  end if;

  if v_pay.status = 'verified_by_admin' then
    raise exception 'تم التحقق من هذه الدفعة مسبقاً' using errcode = 'P0001';
  end if;
  if v_pay.status not in ('paid', 'paid_by_nurse') then
    raise exception 'لا يمكن التحقق من دفعة غير مُحصّلة' using errcode = 'P0001';
  end if;

  update public.payments
     set status = 'verified_by_admin',
         verified_by_admin_id = p_admin_id,
         verified_at = now(),
         updated_at = now()
   where id = p_payment_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  select v_pay.order_id, o.status, 'admin', p_admin_id, p_admin_name,
         'تحقق إداري من الدفعة: ' || v_pay.amount::text || ' ل.س'
    from public.orders o where o.id = v_pay.order_id;

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'order_id',   v_pay.order_id,
    'verified_at', now()
  );
end;
$$;

revoke all on function public.verify_payment_admin(uuid, uuid, text) from public, anon, authenticated;

-- ── 7) refund_payment_admin: full or partial refund.
--      direction='debit' on the wallet of the original collector. If no
--      collector (admin office collection without nurse), no wallet move.
--      Updates payments.refunded_amount and flips status:
--        new total refunded == amount → 'refunded'
--        new total refunded  < amount → 'partially_refunded'
create or replace function public.refund_payment_admin(
  p_payment_id  uuid,
  p_admin_id    uuid,
  p_admin_name  text default null,
  p_amount      numeric default null,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay         public.payments%rowtype;
  v_amount      numeric(14,2);
  v_remaining   numeric(14,2);
  v_new_total   numeric(14,2);
  v_new_status  public.payment_status;
  v_order       public.orders%rowtype;
begin
  if p_payment_id is null then
    raise exception 'payment id is required';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'سبب الاسترجاع مطلوب' using errcode = 'P0001';
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'الدفعة غير موجودة' using errcode = 'P0001';
  end if;

  if v_pay.status not in ('paid', 'paid_by_nurse', 'verified_by_admin', 'partially_refunded') then
    raise exception 'لا يمكن استرجاع دفعة غير مُحصّلة' using errcode = 'P0001';
  end if;

  v_remaining := coalesce(v_pay.amount, 0) - coalesce(v_pay.refunded_amount, 0);
  if v_remaining <= 0 then
    raise exception 'تم استرجاع كامل المبلغ مسبقاً' using errcode = 'P0001';
  end if;

  v_amount := coalesce(p_amount, v_remaining);
  if v_amount <= 0 then
    raise exception 'مبلغ الاسترجاع يجب أن يكون أكبر من صفر' using errcode = 'P0001';
  end if;
  if v_amount > v_remaining then
    raise exception 'لا يمكن استرجاع أكثر من المبلغ المتبقي (% ل.س)', v_remaining
      using errcode = 'P0001';
  end if;

  v_new_total := coalesce(v_pay.refunded_amount, 0) + v_amount;
  v_new_status := case when v_new_total = v_pay.amount
                       then 'refunded'::public.payment_status
                       else 'partially_refunded'::public.payment_status end;

  update public.payments
     set refunded_amount = v_new_total,
         refund_reason   = coalesce(refund_reason || E'\n', '') || trim(p_reason),
         status          = v_new_status,
         refunded_at     = now(),
         updated_at      = now()
   where id = p_payment_id;

  -- orders.payment_status mirrors the payment-row status for consumer-facing
  -- gates. Partial refund still leaves the order "paid" since some money is
  -- in. Full refund flips orders.payment_status='refunded'.
  if v_new_status = 'refunded' then
    update public.orders
       set payment_status = 'refunded', updated_at = now()
     where id = v_pay.order_id;
  end if;

  if v_pay.collected_by_nurse_id is not null then
    insert into public.nurse_wallet_transactions (
      nurse_id, order_id, payment_id, type, direction, amount, currency,
      description_ar, created_by
    )
    values (
      v_pay.collected_by_nurse_id, v_pay.order_id, p_payment_id,
      'refund', 'debit', v_amount, 'SYP',
      'استرجاع للطلب ' || coalesce(
        (select public_number from public.orders where id = v_pay.order_id),
        v_pay.order_id::text
      ) || ' — ' || trim(p_reason),
      p_admin_id
    );
    update public.nurse_wallets
       set balance = balance - v_amount, updated_at = now()
     where nurse_id = v_pay.collected_by_nurse_id;
  end if;

  select * into v_order from public.orders where id = v_pay.order_id;
  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    v_pay.order_id, v_order.status, 'admin', p_admin_id, p_admin_name,
    'تم استرجاع المبلغ: ' || v_amount::text || ' ل.س — ' || trim(p_reason)
  );

  return jsonb_build_object(
    'payment_id',     p_payment_id,
    'order_id',       v_pay.order_id,
    'refunded_amount', v_new_total,
    'status',         v_new_status,
    'refunded_at',    now()
  );
end;
$$;

revoke all on function public.refund_payment_admin(uuid, uuid, text, numeric, text) from public, anon, authenticated;

-- ── 8) accrue_nurse_commission: broaden the paid-row predicate.
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
  v_pay_st     public.payment_status;
begin
  select nurse_id, total, public_number, payment_status
    into v_nurse_id, v_total, v_public, v_pay_st
    from public.orders where id = p_order_id;

  if v_nurse_id is null or v_total is null or v_total <= 0 then return; end if;
  if v_pay_st is distinct from 'paid' then return; end if;

  if not exists (
    select 1 from public.payments
     where order_id = p_order_id
       and status in ('paid', 'paid_by_nurse', 'verified_by_admin', 'partially_refunded')
  ) then
    return;
  end if;

  if exists (
    select 1 from public.nurse_wallet_transactions
     where order_id = p_order_id and type = 'commission_earned'
  ) then
    return;
  end if;

  select coalesce(nurse_commission_percentage, 0)
    into v_rate from public.app_settings where id = 1;
  if v_rate is null or v_rate <= 0 then return; end if;

  v_commission := round(v_total * v_rate / 100.0, 2);
  if v_commission <= 0 then return; end if;

  perform public.ensure_nurse_wallet(v_nurse_id);

  insert into public.nurse_wallet_transactions (
    nurse_id, order_id, type, direction, amount, currency, description_ar,
    commission_rate_snapshot
  )
  values (
    v_nurse_id, p_order_id, 'commission_earned', 'debit', v_commission, 'SYP',
    'عمولة الطلب ' || coalesce(v_public, p_order_id::text) || ' (' || v_rate::text || '%)',
    v_rate
  );

  update public.nurse_wallets
     set balance = balance - v_commission, updated_at = now()
   where nurse_id = v_nurse_id;
end;
$$;

revoke all on function public.accrue_nurse_commission(uuid) from public, anon, authenticated;

-- ── 9) reverse_cash_collection_admin: broaden the paid-row search.
create or replace function public.reverse_cash_collection_admin(
  p_order_id   uuid,
  p_admin_id   uuid,
  p_admin_name text default null,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     public.orders%rowtype;
  v_pay       public.payments%rowtype;
  v_nurse_id  uuid;
  v_amount    numeric(14,2);
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'الطلب غير موجود' using errcode = 'P0001';
  end if;

  select * into v_pay
    from public.payments
   where order_id = p_order_id
     and status in ('paid', 'paid_by_nurse', 'verified_by_admin', 'partially_refunded')
   order by paid_at desc nulls last
   limit 1;
  if not found then return; end if;

  v_amount   := coalesce(v_pay.amount, 0) - coalesce(v_pay.refunded_amount, 0);
  v_nurse_id := v_pay.collected_by_nurse_id;
  if v_amount <= 0 then return; end if;

  update public.payments
     set status          = 'refunded',
         refunded_amount = coalesce(refunded_amount, 0) + v_amount,
         refunded_at     = now(),
         updated_at      = now()
   where id = v_pay.id;

  update public.orders
     set payment_status = 'refunded', updated_at = now()
   where id = p_order_id;

  if v_nurse_id is not null then
    insert into public.nurse_wallet_transactions (
      nurse_id, order_id, payment_id, type, direction, amount, currency,
      description_ar, created_by
    )
    values (
      v_nurse_id, p_order_id, v_pay.id, 'cash_refund', 'debit', v_amount, 'SYP',
      'عكس التحصيل النقدي للطلب ' || coalesce(v_order.public_number, p_order_id::text)
        || coalesce(' — ' || nullif(trim(p_reason), ''), ''),
      p_admin_id
    );
    update public.nurse_wallets
       set balance = balance - v_amount, updated_at = now()
     where nurse_id = v_nurse_id;
  end if;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_order.status, 'admin', p_admin_id, p_admin_name,
    'reverse_cash:' || v_amount::text
      || coalesce(' — ' || nullif(trim(p_reason), ''), '')
  );
end;
$$;

revoke all on function public.reverse_cash_collection_admin(uuid, uuid, text, text) from public, anon, authenticated;

-- ── 10) Update finance summary view: total_refunded.
create or replace view public.nurse_finance_summary as
select
  n.id                                                     as nurse_id,
  p.full_name                                              as nurse_name,
  coalesce(w.balance, 0)                                   as net_due,
  coalesce(sum(t.amount) filter (where t.type = 'cash_collected'),     0) as total_collected,
  coalesce(sum(t.amount) filter (where t.type = 'commission_earned'),  0) as total_commission,
  coalesce(sum(t.amount) filter (where t.type = 'settlement_paid'),    0) as total_settled,
  coalesce(sum(t.amount) filter (where t.type = 'adjustment'),         0) as total_adjustments,
  coalesce(sum(t.amount) filter (where t.type in ('refund', 'cash_refund')), 0) as total_refunded
from public.nurses n
left join public.profiles  p on p.id = n.profile_id
left join public.nurse_wallets w on w.nurse_id = n.id
left join public.nurse_wallet_transactions t on t.nurse_id = n.id
where n.deleted_at is null
group by n.id, p.full_name, w.balance;

revoke all on public.nurse_finance_summary from public, anon, authenticated;
