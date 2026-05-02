-- ============================================================================
-- 010_seed_phase1_demo_customers.sql
-- Phase 1 (mock auth + service-role API routes): seed two demo customers,
-- their profile chain, plus customer 1's seed patients/addresses, and add a
-- service-role-only RPC that places an order with an explicit customer_id.
--
-- This migration is additive. It does not modify earlier migrations.
-- The matching frontend ids live in src/lib/mock-data.ts as constants:
--   SEED_CUSTOMER_1_PROFILE_ID  ↔ 00000000-0000-4000-8000-000000000101
--   SEED_CUSTOMER_1_ID          ↔ 00000000-0000-4000-8000-00000000c001
--   SEED_PATIENT_1_ID           ↔ 00000000-0000-4000-8000-00000000d001
--   SEED_PATIENT_2_ID           ↔ 00000000-0000-4000-8000-00000000d002
--   SEED_ADDRESS_1_ID           ↔ 00000000-0000-4000-8000-00000000e001
--   SEED_ADDRESS_2_ID           ↔ 00000000-0000-4000-8000-00000000e002
--   SEED_CUSTOMER_2_PROFILE_ID  ↔ 00000000-0000-4000-8000-000000000102
--   SEED_CUSTOMER_2_ID          ↔ 00000000-0000-4000-8000-00000000c002
--
-- When real Supabase Auth is wired in a later phase:
--   1. Replace these seeded auth.users rows with rows created by sign-up.
--   2. Drop the place_order_admin RPC.
--   3. Frontend calls place_order directly with a real session.
-- ============================================================================

-- ── Demo auth.users rows ----------------------------------------------------
-- Direct inserts into auth.users are supported by the postgres role that runs
-- migrations. The handle_new_user trigger (002) auto-creates a profiles row
-- and a customers row with a random id; we patch the customer id to a
-- deterministic UUID immediately after.
insert into auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  ('00000000-0000-4000-8000-000000000101',
   'customer1@phase1.invalid',
   crypt('phase1-mock-password-do-not-use', gen_salt('bf')),
   now(),
   'authenticated',
   'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"أحمد محمد علي"}'::jsonb,
   now(),
   now()),
  ('00000000-0000-4000-8000-000000000102',
   'customer2@phase1.invalid',
   crypt('phase1-mock-password-do-not-use', gen_salt('bf')),
   now(),
   'authenticated',
   'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"فاطمة الحسن"}'::jsonb,
   now(),
   now())
on conflict (id) do nothing;

-- ── Patch customer ids to deterministic UUIDs --------------------------------
-- Trigger handle_new_user already inserted profiles + customers via random
-- uuid_generate_v4(). We rename the customer id so the API route can resolve
-- it from the mock session's linkedEntityId without an extra lookup.
update public.customers
   set id = '00000000-0000-4000-8000-00000000c001'
 where profile_id = '00000000-0000-4000-8000-000000000101'
   and id <> '00000000-0000-4000-8000-00000000c001';

update public.customers
   set id = '00000000-0000-4000-8000-00000000c002'
 where profile_id = '00000000-0000-4000-8000-000000000102'
   and id <> '00000000-0000-4000-8000-00000000c002';

-- ── Seed patients (customer 1 only) ------------------------------------------
insert into public.patients (id, customer_id, name, is_default)
values
  ('00000000-0000-4000-8000-00000000d001',
   '00000000-0000-4000-8000-00000000c001',
   'أحمد محمد علي',
   true),
  ('00000000-0000-4000-8000-00000000d002',
   '00000000-0000-4000-8000-00000000c001',
   'فاطمة أحمد',
   false)
on conflict (id) do nothing;

-- ── Seed addresses (customer 1 only) -----------------------------------------
insert into public.addresses (id, customer_id, label, description, city, lat, lng, is_default)
values
  ('00000000-0000-4000-8000-00000000e001',
   '00000000-0000-4000-8000-00000000c001',
   'المنزل',
   'المزة – شارع الفردوس، بناء رقم 12، الطابق 3',
   'دمشق', 33.5138, 36.2765, true),
  ('00000000-0000-4000-8000-00000000e002',
   '00000000-0000-4000-8000-00000000c001',
   'العمل',
   'المالكي – برج المعلومات، الطابق 5',
   'دمشق', 33.5203, 36.2912, false)
on conflict (id) do nothing;

-- ============================================================================
-- place_order_admin: same shape as place_order but customer_id is a parameter
-- instead of being looked up via auth.uid(). Service-role only — never granted
-- to anon or authenticated. Browser must never call this directly.
-- ============================================================================

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
  v_existing uuid;
  v_order_id uuid;
  v_item     jsonb;
begin
  if p_customer_id is null then
    raise exception 'p_customer_id is required';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer % does not exist', p_customer_id;
  end if;

  -- Idempotency check.
  select order_id into v_existing
    from public.order_idempotency
   where customer_id = p_customer_id
     and order_idempotency.idempotency_key = place_order_admin.idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.orders (
    public_number, customer_id, patient_id, address_id,
    kind, package_id, package_snapshot, status,
    visit_date, shift, shift_start_time, shift_end_time,
    subtotal, coupon_code, coupon_discount, total,
    payment_method, payment_status
  )
  values (
    payload->>'public_number',
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

-- Service-role only. No grants to anon / authenticated. The Next.js API route
-- holds the service-role key server-side and is the sole caller.
revoke all on function public.place_order_admin(jsonb, uuid, text) from public;
revoke all on function public.place_order_admin(jsonb, uuid, text) from anon;
revoke all on function public.place_order_admin(jsonb, uuid, text) from authenticated;
