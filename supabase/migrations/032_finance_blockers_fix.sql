-- ============================================================================
-- 032_finance_blockers_fix.sql
-- Phase 4.1.1 — close the financial-integrity blockers found by the audit.
--
-- 1) Every order owns a payments row from creation (place_order_admin seeds
--    a pending row; nurse_collect_cash promotes it).
-- 2) Legacy paths can no longer mark a cash order paid off-ledger:
--    set_payment_status_admin refuses 'paid' for cash orders entirely (the
--    admin must use admin_record_cash_payment, the canonical RPC).
-- 3) Commission accrues only when payment_status='paid' AND a paid payments
--    row exists. force_complete_order_admin refuses unpaid orders unless the
--    caller acknowledges with p_allow_unpaid=true (kept available for
--    operations recovery — the wallet is left untouched, no commission).
-- 4) Cancelling a paid order runs reverse_cash_collection_admin: refunds the
--    payment row and posts a cash_refund debit on the wallet.
-- 5) apply_coupon_admin refuses changes once an order is paid.
-- 6) accrue_nurse_commission stamps commission_rate_snapshot on the txn.
-- 7) admin_record_cash_payment — atomic RPC the OCC calls when an admin marks
--    a cash order paid (e.g. office collection without a nurse). Mirrors the
--    nurse_collect_cash side-effects but books the wallet against the order's
--    nurse_id when present, otherwise records the payment with no nurse and
--    no wallet movement (off-route admin collections are tracked in payments
--    only — the rule "payment row required" still holds).
-- ============================================================================

-- ── 1) Backfill: every existing order needs a payments row matching its
--      payment_status. Paid orders get a paid row (without retroactively
--      crediting any wallet — historical money is assumed already accounted
--      for). Pending orders get a pending row.
do $$ begin
  insert into public.payments (order_id, method, amount, currency, status, provider, paid_at)
  select o.id, o.payment_method, o.total, 'SYP',
         o.payment_status,
         case when o.payment_method = 'cash' then 'cash' else null end,
         case when o.payment_status = 'paid' then o.updated_at else null end
    from public.orders o
   where not exists (select 1 from public.payments p where p.order_id = o.id);
exception when unique_violation then null; end $$;

-- ── 2) place_order_admin: seed a pending payments row at creation. Re-uses
--      the existing function shape (jsonb payload + customer + idempotency).
create or replace function public.place_order_admin(
  payload          jsonb,
  p_customer_id    uuid,
  idempotency_key  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing      uuid;
  v_order_id      uuid;
  v_item          jsonb;
  v_public_number text;
  v_method        public.payment_method;
  v_status        public.payment_status;
  v_total         numeric(12,2);
begin
  if p_customer_id is null then
    raise exception 'p_customer_id is required';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer % does not exist', p_customer_id;
  end if;

  select order_id into v_existing
    from public.order_idempotency
   where customer_id = p_customer_id
     and order_idempotency.idempotency_key = place_order_admin.idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  v_public_number := public.generate_public_order_number();
  v_method := (payload->>'payment_method')::public.payment_method;
  v_status := coalesce((payload->>'payment_status')::public.payment_status, 'pending');
  v_total  := coalesce((payload->>'total')::numeric, 0);

  insert into public.orders (
    public_number, customer_id, patient_id, address_id,
    kind, package_id, package_snapshot, status,
    visit_date, shift, shift_start_time, shift_end_time,
    subtotal, coupon_code, coupon_discount, total,
    payment_method, payment_status, prescription_url
  )
  values (
    v_public_number,
    p_customer_id,
    (payload->>'patient_id')::uuid,
    (payload->>'address_id')::uuid,
    (payload->>'kind')::public.order_kind,
    nullif(payload->>'package_id','')::uuid,
    payload->'package_snapshot',
    coalesce((payload->>'status')::public.order_status, 'pending_payment'),
    (payload->>'visit_date')::date,
    (payload->>'shift')::public.shift_window,
    nullif(payload->>'shift_start_time','')::time,
    nullif(payload->>'shift_end_time','')::time,
    coalesce((payload->>'subtotal')::numeric, 0),
    nullif(payload->>'coupon_code',''),
    coalesce((payload->>'coupon_discount')::numeric, 0),
    v_total,
    v_method,
    v_status,
    nullif(payload->>'prescription_url','')
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    insert into public.order_items (
      order_id, lab_test_id, name_ar_snapshot, name_en_snapshot,
      price_snapshot, display_order
    )
    values (
      v_order_id,
      (v_item->>'lab_test_id')::uuid,
      v_item->>'name_ar_snapshot',
      nullif(v_item->>'name_en_snapshot',''),
      coalesce((v_item->>'price_snapshot')::numeric, 0),
      coalesce((v_item->>'display_order')::int, 0)
    );
  end loop;

  -- Phase 4.1.1: every order owns a payments row from creation. The pending
  -- row is upgraded by nurse_collect_cash / admin_record_cash_payment.
  insert into public.payments (order_id, method, amount, currency, status, provider)
  values (v_order_id, v_method, v_total, 'SYP', v_status,
          case when v_method = 'cash' then 'cash' else null end);

  insert into public.order_status_history (order_id, status, actor_role, actor_id, note)
  values (
    v_order_id,
    coalesce((payload->>'status')::public.order_status, 'pending_payment'),
    'customer',
    null,
    'order created'
  );

  insert into public.order_idempotency (customer_id, idempotency_key, order_id)
  values (p_customer_id, place_order_admin.idempotency_key, v_order_id);

  return v_order_id;
end;
$$;

revoke all on function public.place_order_admin(jsonb, uuid, text) from public, anon, authenticated;

-- ── 3) Snapshot column for commission rate audit trail.
do $$ begin
  alter table public.nurse_wallet_transactions
    add column if not exists commission_rate_snapshot numeric(5,2);
exception when duplicate_column then null; end $$;

-- New ledger type for cancellation reversal of cash collection.
do $$ begin
  alter type public.nurse_wallet_txn_type add value if not exists 'cash_refund';
exception when invalid_text_representation then null; end $$;

-- ── 4) nurse_collect_cash: promote an existing pending row instead of
--      always inserting. Idempotency, ownership, payment-method, and
--      "must be arrived" guards unchanged.
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

  -- Promote the pending row if it exists; otherwise insert. Either way the
  -- partial unique index payments_one_paid_per_order ensures exactly one
  -- paid row.
  update public.payments
     set status = 'paid', amount = v_amount, currency = 'SYP', provider = 'cash',
         method = 'cash', paid_at = now(),
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
      p_order_id, 'cash', v_amount, 'SYP', 'paid', 'cash',
      now(), p_nurse_id, now()
    )
    returning id into v_payment_id;
  end if;

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
    'order_id',   p_order_id,
    'payment_id', v_payment_id,
    'amount',     v_amount,
    'paid_at',    now()
  );
end;
$$;

revoke all on function public.nurse_collect_cash(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ── 5) admin_record_cash_payment — admin office collection. Same on-ledger
--      contract as nurse_collect_cash; either books the wallet against the
--      order's currently-assigned nurse OR — if no nurse assigned — only
--      writes the payments row + history (no wallet entry, no commission
--      will accrue because accrue_nurse_commission requires a nurse).
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
     set status = 'paid', amount = v_amount, currency = 'SYP', provider = 'cash',
         method = 'cash', paid_at = now(),
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
      p_order_id, 'cash', v_amount, 'SYP', 'paid', 'cash',
      now(), p_admin_id, now()
    )
    returning id into v_payment_id;
  end if;

  update public.orders
     set payment_status = 'paid', updated_at = now()
   where id = p_order_id;

  -- Wallet movement when the order is on a nurse: same accounting as if the
  -- nurse had collected. Admin office-collection without nurse assignment
  -- skips the wallet to avoid creating a phantom credit.
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
    coalesce(nullif(trim(p_note), ''), 'تسجيل تحصيل نقدي عبر الإدارة') ||
      ' — ' || v_amount::text || ' ل.س'
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

-- ── 6) reverse_cash_collection_admin — used by cancel_order_admin and the
--      refund flow. Marks the paid payment row refunded and books a
--      cash_refund debit on the nurse wallet that originally took credit.
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

  -- Find the active paid payment row. Idempotent: if none exists or already
  -- refunded, exit cleanly so the caller can run unconditionally.
  select * into v_pay
    from public.payments
   where order_id = p_order_id and status = 'paid'
   order by paid_at desc nulls last
   limit 1;
  if not found then
    return;
  end if;

  v_amount   := coalesce(v_pay.amount, 0);
  v_nurse_id := v_pay.collected_by_nurse_id;

  update public.payments
     set status      = 'refunded',
         refunded_at = now(),
         updated_at  = now()
   where id = v_pay.id;

  update public.orders
     set payment_status = 'refunded', updated_at = now()
   where id = p_order_id;

  if v_nurse_id is not null and v_amount > 0 then
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
    'reverse_cash:' || v_amount::text || coalesce(' — ' || nullif(trim(p_reason), ''), '')
  );
end;
$$;

revoke all on function public.reverse_cash_collection_admin(uuid, uuid, text, text) from public, anon, authenticated;

-- ── 7) cancel_order_admin: run reversal first when the order is currently
--      paid, then mark the order cancelled. The reversal is idempotent and
--      no-ops on already-unpaid orders.
create or replace function public.cancel_order_admin(
  p_order_id    uuid,
  p_reason      text,
  p_actor_role  public.user_role,
  p_actor_id    uuid    default null,
  p_actor_name  text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.payment_status;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;

  select payment_status into v_status from public.orders where id = p_order_id;
  if v_status = 'paid' then
    perform public.reverse_cash_collection_admin(p_order_id, p_actor_id, p_actor_name, p_reason);
  end if;

  update public.orders
     set status = 'cancelled', updated_at = now()
   where id = p_order_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, 'cancelled', p_actor_role, p_actor_id, p_actor_name,
    'cancel' || coalesce(': ' || nullif(trim(p_reason), ''), '')
  );
end;
$$;

revoke all on function public.cancel_order_admin(uuid, text, public.user_role, uuid, text) from public, anon, authenticated;

-- ── 8) set_payment_status_admin: refuse 'paid' (admin must use
--      admin_record_cash_payment). Permit 'refunded' but only after running
--      the reversal first when the order is currently paid.
create or replace function public.set_payment_status_admin(
  p_order_id        uuid,
  p_payment_status  public.payment_status,
  p_actor_role      public.user_role,
  p_actor_id        uuid    default null,
  p_actor_name      text    default null,
  p_note            text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   public.order_status;
  v_pay_st   public.payment_status;
  v_method   public.payment_method;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;

  if p_payment_status = 'paid' then
    raise exception 'لا يمكن وضع الطلب كمدفوع من هنا. استخدم تسجيل التحصيل النقدي أو مسار الدفع الإلكتروني'
      using errcode = 'P0001';
  end if;

  select payment_status, payment_method
    into v_pay_st, v_method
    from public.orders where id = p_order_id;

  if p_payment_status = 'refunded' then
    if v_pay_st = 'paid' then
      perform public.reverse_cash_collection_admin(p_order_id, p_actor_id, p_actor_name, p_note);
      -- reverse_cash_collection_admin already set payment_status='refunded'
      -- and wrote a history row. Avoid duplicate writes.
      return;
    end if;
  end if;

  update public.orders
     set payment_status = p_payment_status,
         updated_at = now()
   where id = p_order_id
   returning status into v_status;

  -- Keep the (still-unpaid) payments row in sync so the dashboard stays
  -- consistent with orders.payment_status.
  update public.payments
     set status = p_payment_status, updated_at = now()
   where order_id = p_order_id and status not in ('paid', 'refunded');

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_status, p_actor_role, p_actor_id, p_actor_name,
    'payment_status:' || p_payment_status::text || coalesce(' — ' || p_note, '')
  );
end;
$$;

revoke all on function public.set_payment_status_admin(uuid, public.payment_status, public.user_role, uuid, text, text) from public, anon, authenticated;

-- ── 9) accrue_nurse_commission: gate on payment_status='paid' AND a paid
--      payments row. Snapshot the rate used.
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

  if v_nurse_id is null or v_total is null or v_total <= 0 then
    return;
  end if;
  if v_pay_st is distinct from 'paid' then
    return;
  end if;
  if not exists (
    select 1 from public.payments
     where order_id = p_order_id and status = 'paid'
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
  if v_rate is null or v_rate <= 0 then
    return;
  end if;

  v_commission := round(v_total * v_rate / 100.0, 2);
  if v_commission <= 0 then
    return;
  end if;

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
     set balance    = balance - v_commission,
         updated_at = now()
   where nurse_id = v_nurse_id;
end;
$$;

revoke all on function public.accrue_nurse_commission(uuid) from public, anon, authenticated;

-- ── 10) force_complete_order_admin: refuse unpaid by default. The
--       p_allow_unpaid escape hatch keeps the operations recovery path
--       (e.g. closing a stuck order) but explicitly skips commission and
--       wallet movement, and stamps the history row so audits can find it.
create or replace function public.force_complete_order_admin(
  p_order_id      uuid,
  p_reason        text,
  p_actor_role    public.user_role default 'admin',
  p_actor_id      uuid    default null,
  p_actor_name    text    default null,
  p_allow_unpaid  boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay_st public.payment_status;
  v_note   text;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'reason is required';
  end if;

  select payment_status into v_pay_st from public.orders where id = p_order_id;
  if v_pay_st is distinct from 'paid' and not p_allow_unpaid then
    raise exception 'لا يمكن إغلاق طلب غير مدفوع. سجّل التحصيل أولاً أو ألغِ الطلب.'
      using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'completed', updated_at = now()
   where id = p_order_id;

  v_note := 'force:' || trim(p_reason)
    || case when v_pay_st is distinct from 'paid' then ' [unpaid_force]' else '' end;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (p_order_id, 'completed', p_actor_role, p_actor_id, p_actor_name, v_note);
end;
$$;

revoke all on function public.force_complete_order_admin(uuid, text, public.user_role, uuid, text, boolean) from public, anon, authenticated;

-- ── 11) apply_coupon_admin: refuse if the order is already paid OR has a
--       paid payments row.
create or replace function public.apply_coupon_admin(
  p_order_id        uuid,
  p_coupon_code     text,
  p_coupon_discount numeric,
  p_total           numeric,
  p_actor_role      public.user_role,
  p_actor_id        uuid    default null,
  p_actor_name      text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.order_status;
  v_pay_st public.payment_status;
  v_note   text;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;

  select payment_status into v_pay_st from public.orders where id = p_order_id;
  if v_pay_st = 'paid' or exists (
    select 1 from public.payments where order_id = p_order_id and status = 'paid'
  ) then
    raise exception 'لا يمكن تعديل الكوبون بعد تأكيد الدفع' using errcode = 'P0001';
  end if;

  update public.orders
     set coupon_code = nullif(p_coupon_code, ''),
         coupon_discount = coalesce(p_coupon_discount, 0),
         total = coalesce(p_total, total),
         updated_at = now()
   where id = p_order_id
   returning status into v_status;

  -- Keep the pending payment row's amount in sync with the new total so
  -- collection time always sees the canonical figure.
  update public.payments
     set amount = coalesce(p_total, amount), updated_at = now()
   where order_id = p_order_id and status = 'pending';

  v_note := case
    when p_coupon_code is null or p_coupon_code = ''
    then 'coupon:cleared'
    else 'coupon:' || p_coupon_code || ':' || coalesce(p_coupon_discount, 0)::text
  end;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (p_order_id, v_status, p_actor_role, p_actor_id, p_actor_name, v_note);
end;
$$;

revoke all on function public.apply_coupon_admin(uuid, text, numeric, numeric, public.user_role, uuid, text) from public, anon, authenticated;
