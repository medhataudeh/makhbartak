-- ============================================================================
-- 007_rpc_place_order.sql
-- RPC for atomic order placement.
-- ============================================================================
--
-- The frontend calls supabase.rpc('place_order', { payload, idempotency_key }).
-- The function:
--   1. Looks up the customer for auth.uid().
--   2. Returns the existing order_id when (customer_id, idempotency_key) is
--      already used (idempotency contract).
--   3. Otherwise inserts orders + order_items + initial order_status_history
--      in a single transaction.
--   4. Returns the new order_id.
--
-- Payload shape (jsonb):
--   {
--     "public_number": "HL-2026-000123",
--     "patient_id": uuid,
--     "address_id": uuid,
--     "kind": "package" | "prescription" | "custom",
--     "package_id": uuid | null,
--     "package_snapshot": { ... } | null,
--     "status": "pending_payment" | "paid" | ...,
--     "visit_date": "2026-05-08",
--     "shift": "morning" | "evening",
--     "shift_start_time": "08:00" | null,
--     "shift_end_time": "10:00" | null,
--     "subtotal": 1500,
--     "coupon_code": "SAVE10" | null,
--     "coupon_discount": 150,
--     "total": 1350,
--     "payment_method": "cash" | "online",
--     "payment_status": "pending" | "paid",
--     "items": [
--       { "lab_test_id": uuid, "name_ar_snapshot": "...", "name_en_snapshot": "...", "price_snapshot": 350, "display_order": 0 },
--       ...
--     ]
--   }
-- ============================================================================

-- Dedupe table for idempotency. Same key from same customer returns the
-- existing order_id; never creates a duplicate.
create table if not exists public.order_idempotency (
  customer_id      uuid not null references public.customers(id) on delete cascade,
  idempotency_key  text not null,
  order_id         uuid not null references public.orders(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (customer_id, idempotency_key)
);

create or replace function public.place_order(
  payload          jsonb,
  idempotency_key  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_existing    uuid;
  v_order_id    uuid;
  v_item        jsonb;
begin
  -- Resolve customer for the signed-in user.
  select id into v_customer_id
    from public.customers
   where profile_id = auth.uid();
  if v_customer_id is null then
    raise exception 'no customer for current user';
  end if;

  -- Idempotency check.
  select order_id into v_existing
    from public.order_idempotency
   where customer_id = v_customer_id
     and order_idempotency.idempotency_key = place_order.idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Insert order.
  insert into public.orders (
    public_number, customer_id, patient_id, address_id,
    kind, package_id, package_snapshot, status,
    visit_date, shift, shift_start_time, shift_end_time,
    subtotal, coupon_code, coupon_discount, total,
    payment_method, payment_status
  )
  values (
    payload->>'public_number',
    v_customer_id,
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
    coalesce((payload->>'total')::numeric, 0),
    (payload->>'payment_method')::public.payment_method,
    coalesce((payload->>'payment_status')::public.payment_status, 'pending')
  )
  returning id into v_order_id;

  -- Insert items.
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

  -- Initial status_history row.
  insert into public.order_status_history (order_id, status, actor_role, actor_id, note)
  values (
    v_order_id,
    coalesce((payload->>'status')::public.order_status, 'pending_payment'),
    'customer',
    auth.uid(),
    'order created'
  );

  -- Record idempotency.
  insert into public.order_idempotency (customer_id, idempotency_key, order_id)
  values (v_customer_id, place_order.idempotency_key, v_order_id);

  return v_order_id;
end;
$$;

-- Allow authenticated callers to invoke. RLS isn't bypassed inside the
-- function body because security definer + the customer lookup gates by
-- auth.uid(); the function itself is the policy boundary.
grant execute on function public.place_order(jsonb, text) to authenticated;
