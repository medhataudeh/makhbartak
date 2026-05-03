-- ============================================================================
-- 018_customer_profile.sql
-- Stage E: customer profile admin RPCs (patients, addresses, payment pref).
--
-- All RPCs are service-role only. The Next.js API routes at
--   /api/customers/[id]/profile
--   /api/customers/[id]/patients[/[pid]]
--   /api/customers/[id]/addresses[/[aid]]
--   /api/customers/[id]/payment-preference
-- are the sole callers; browser never invokes these RPCs directly.
--
-- Each upsert returns the canonical row so the client can swap the local
-- placeholder UUID for the real one before any order placement runs.
-- ============================================================================

-- ── upsert_patient_admin ────────────────────────────────────────────────────
-- p_id is optional. Null/missing → insert (returns the new uuid). Non-null →
-- update the existing row by id (after verifying it belongs to the customer).
-- p_is_default = true sets this patient as the default and clears the flag
-- on every other patient row for the same customer (atomic).
create or replace function public.upsert_patient_admin(
  p_customer_id  uuid,
  p_id           uuid    default null,
  p_name         text    default null,
  p_national_id  text    default null,
  p_note         text    default null,
  p_is_default   boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer % does not exist', p_customer_id;
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'patient name is required';
  end if;

  if p_id is null then
    insert into public.patients (customer_id, name, national_id, note, is_default)
    values (
      p_customer_id, trim(p_name),
      nullif(trim(p_national_id), ''),
      nullif(trim(p_note), ''),
      coalesce(p_is_default, false)
    )
    returning id into v_id;
  else
    if not exists (
      select 1 from public.patients where id = p_id and customer_id = p_customer_id
    ) then
      raise exception 'patient % does not belong to customer %', p_id, p_customer_id;
    end if;
    update public.patients
       set name = trim(p_name),
           national_id = nullif(trim(p_national_id), ''),
           note = nullif(trim(p_note), ''),
           is_default = coalesce(p_is_default, is_default),
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;

  if coalesce(p_is_default, false) then
    update public.patients
       set is_default = (id = v_id),
           updated_at = case when id = v_id then updated_at else now() end
     where customer_id = p_customer_id;
    update public.customers
       set default_patient_id = v_id, updated_at = now()
     where id = p_customer_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.upsert_patient_admin(uuid, uuid, text, text, text, boolean) from public;
revoke all on function public.upsert_patient_admin(uuid, uuid, text, text, text, boolean) from anon;
revoke all on function public.upsert_patient_admin(uuid, uuid, text, text, text, boolean) from authenticated;

-- ── delete_patient_admin ────────────────────────────────────────────────────
create or replace function public.delete_patient_admin(
  p_customer_id  uuid,
  p_id           uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.patients where id = p_id and customer_id = p_customer_id
  ) then
    raise exception 'patient % does not belong to customer %', p_id, p_customer_id;
  end if;
  delete from public.patients where id = p_id;
end;
$$;

revoke all on function public.delete_patient_admin(uuid, uuid) from public;
revoke all on function public.delete_patient_admin(uuid, uuid) from anon;
revoke all on function public.delete_patient_admin(uuid, uuid) from authenticated;

-- ── upsert_address_admin ────────────────────────────────────────────────────
create or replace function public.upsert_address_admin(
  p_customer_id  uuid,
  p_id           uuid    default null,
  p_label        text    default null,
  p_description  text    default null,
  p_city         text    default null,
  p_area         text    default null,
  p_lat          numeric default null,
  p_lng          numeric default null,
  p_is_default   boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer % does not exist', p_customer_id;
  end if;
  if nullif(trim(p_label), '') is null then
    raise exception 'address label is required';
  end if;
  if nullif(trim(p_description), '') is null then
    raise exception 'address description is required';
  end if;
  if nullif(trim(p_city), '') is null then
    raise exception 'address city is required';
  end if;

  if p_id is null then
    insert into public.addresses (
      customer_id, label, description, city, area, lat, lng, is_default
    )
    values (
      p_customer_id, trim(p_label), trim(p_description), trim(p_city),
      nullif(trim(p_area), ''), p_lat, p_lng,
      coalesce(p_is_default, false)
    )
    returning id into v_id;
  else
    if not exists (
      select 1 from public.addresses where id = p_id and customer_id = p_customer_id
    ) then
      raise exception 'address % does not belong to customer %', p_id, p_customer_id;
    end if;
    update public.addresses
       set label = trim(p_label),
           description = trim(p_description),
           city = trim(p_city),
           area = nullif(trim(p_area), ''),
           lat = coalesce(p_lat, lat),
           lng = coalesce(p_lng, lng),
           is_default = coalesce(p_is_default, is_default),
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;

  if coalesce(p_is_default, false) then
    update public.addresses
       set is_default = (id = v_id),
           updated_at = case when id = v_id then updated_at else now() end
     where customer_id = p_customer_id;
    update public.customers
       set default_address_id = v_id, updated_at = now()
     where id = p_customer_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.upsert_address_admin(uuid, uuid, text, text, text, text, numeric, numeric, boolean) from public;
revoke all on function public.upsert_address_admin(uuid, uuid, text, text, text, text, numeric, numeric, boolean) from anon;
revoke all on function public.upsert_address_admin(uuid, uuid, text, text, text, text, numeric, numeric, boolean) from authenticated;

-- ── delete_address_admin ────────────────────────────────────────────────────
create or replace function public.delete_address_admin(
  p_customer_id  uuid,
  p_id           uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.addresses where id = p_id and customer_id = p_customer_id
  ) then
    raise exception 'address % does not belong to customer %', p_id, p_customer_id;
  end if;
  delete from public.addresses where id = p_id;
end;
$$;

revoke all on function public.delete_address_admin(uuid, uuid) from public;
revoke all on function public.delete_address_admin(uuid, uuid) from anon;
revoke all on function public.delete_address_admin(uuid, uuid) from authenticated;

-- ── set_payment_pref_admin ──────────────────────────────────────────────────
create or replace function public.set_payment_pref_admin(
  p_customer_id  uuid,
  p_method       public.payment_method
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer % does not exist', p_customer_id;
  end if;
  update public.customers
     set preferred_payment_method = p_method,
         updated_at = now()
   where id = p_customer_id;
end;
$$;

revoke all on function public.set_payment_pref_admin(uuid, public.payment_method) from public;
revoke all on function public.set_payment_pref_admin(uuid, public.payment_method) from anon;
revoke all on function public.set_payment_pref_admin(uuid, public.payment_method) from authenticated;
