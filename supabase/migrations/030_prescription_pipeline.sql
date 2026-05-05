-- ============================================================================
-- 030_prescription_pipeline.sql
-- Phase 3.6 reflection-fix:
--   * Persist the customer-uploaded prescription image as `orders.prescription_url`.
--   * Reserve a private storage bucket `prescriptions` for the file blob.
--   * place_order_admin reads payload->>'prescription_url' and writes it
--     onto the row.
-- ============================================================================

-- ── Column ─────────────────────────────────────────────────────────────────
do $$ begin
  alter table public.orders
    add column if not exists prescription_url text;
exception when duplicate_column then null; end $$;

comment on column public.orders.prescription_url is
  'Storage path or signed URL of the customer-uploaded prescription image. NULL for non-prescription orders.';

-- ── Storage bucket ─────────────────────────────────────────────────────────
-- Private bucket; signed URLs are minted server-side at hydrate time, the
-- same pattern used for `lab-results` (migration 005).
insert into storage.buckets (id, name, public)
values ('prescriptions', 'prescriptions', false)
on conflict (id) do nothing;

-- ── place_order_admin: forward prescription_url from payload ───────────────
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

  select order_id into v_existing
    from public.order_idempotency
   where customer_id = p_customer_id
     and order_idempotency.idempotency_key = place_order_admin.idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  v_public_number := public.generate_public_order_number();

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
    coalesce((payload->>'total')::numeric, 0),
    (payload->>'payment_method')::public.payment_method,
    coalesce((payload->>'payment_status')::public.payment_status, 'pending'),
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

revoke all on function public.place_order_admin(jsonb, uuid, text) from public;
revoke all on function public.place_order_admin(jsonb, uuid, text) from anon;
revoke all on function public.place_order_admin(jsonb, uuid, text) from authenticated;
