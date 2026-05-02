-- ============================================================================
-- 011_order_public_number_sequence.sql
-- Move public_number generation server-side. The frontend used to send a
-- locally-computed HL-YYYY-XXXXXX which could collide after a localStorage
-- reset or refresh; the server now ignores any payload public_number and
-- generates one from a dedicated sequence.
--
-- This migration is additive. It does not touch the existing place_order
-- RPC (used by the future authenticated browser path); only place_order_admin
-- is rewritten.
-- ============================================================================

-- ── Sequence ----------------------------------------------------------------
create sequence if not exists public.order_public_number_seq
  start with 1
  increment by 1
  no cycle;

-- Allow the function (security definer) to advance the sequence.
grant usage, select on sequence public.order_public_number_seq to postgres;

-- ── Generator function ------------------------------------------------------
-- Format: HL-YYYY-NNNNNN where YYYY is the current year (server clock) and
-- NNNNNN is a zero-padded global sequence value. The sequence does not reset
-- per year — that keeps generation collision-free across year boundaries
-- without requiring a separate sequence-per-year and a periodic rotation.
create or replace function public.generate_public_order_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'HL-'
      || extract(year from now())::text
      || '-'
      || lpad(nextval('public.order_public_number_seq')::text, 6, '0');
$$;

-- ── Replace place_order_admin to ignore client public_number ----------------
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
begin
  if p_customer_id is null then
    raise exception 'p_customer_id is required';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer % does not exist', p_customer_id;
  end if;

  -- Idempotency: same key from the same customer returns the *existing*
  -- order id and never advances the sequence — so no public_number is burnt
  -- on retries.
  select order_id into v_existing
    from public.order_idempotency
   where customer_id = p_customer_id
     and order_idempotency.idempotency_key = place_order_admin.idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Generate the public number server-side. Any value the client sent in
  -- payload->>'public_number' is intentionally ignored.
  v_public_number := public.generate_public_order_number();

  insert into public.orders (
    public_number, customer_id, patient_id, address_id,
    kind, package_id, package_snapshot, status,
    visit_date, shift, shift_start_time, shift_end_time,
    subtotal, coupon_code, coupon_discount, total,
    payment_method, payment_status
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
    coalesce((payload->>'total')::numeric, 0),
    (payload->>'payment_method')::public.payment_method,
    coalesce((payload->>'payment_status')::public.payment_status, 'pending')
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

-- Service-role only. Re-revoke after CREATE OR REPLACE in case the previous
-- definition's grants leaked through.
revoke all on function public.place_order_admin(jsonb, uuid, text) from public;
revoke all on function public.place_order_admin(jsonb, uuid, text) from anon;
revoke all on function public.place_order_admin(jsonb, uuid, text) from authenticated;
