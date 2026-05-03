-- ============================================================================
-- 016_nurse_state.sql
-- Stage C: nurse profile + per-day prep state + shortage requests + nurse seed.
--
-- 1. Seed three demo nurse users (auth.users + profiles + nurses) with
--    deterministic UUIDs that match the frontend SEED_NURSE_*_ID constants.
-- 2. Two new tables: nurse_prep_state, nurse_shortage_requests +
--    nurse_shortage_request_items.
-- 3. Four service-role admin RPCs:
--      * update_nurse_profile_admin   — name/photo via profiles, city via nurses
--      * set_nurse_prep_admin         — upsert per-(nurse,day) prep state
--      * submit_shortage_request_admin   — atomic insert request + items
--      * set_shortage_request_status_admin   — admin marks pending/ack/resolved
--
-- Service-role only on every RPC. Browser must never invoke them directly.
-- ============================================================================

-- ── Seed nurse auth users + profiles + nurses ──────────────────────────────
-- Pattern mirrors migration 010 for customers. The handle_new_user trigger
-- (002:691) auto-creates a profiles + customers row; we then patch the
-- profiles row to role='nurse', drop the auto-created customers row, and
-- insert our deterministic-UUID nurses row.

insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000000201',
   'nurse1@phase3.invalid',
   crypt('phase3-mock-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"محمد الأحمد"}'::jsonb,
   now(), now()),
  ('00000000-0000-4000-8000-000000000202',
   'nurse2@phase3.invalid',
   crypt('phase3-mock-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"سارة السيد"}'::jsonb,
   now(), now()),
  ('00000000-0000-4000-8000-000000000203',
   'nurse3@phase3.invalid',
   crypt('phase3-mock-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"ليث ناصر"}'::jsonb,
   now(), now())
on conflict (id) do nothing;

-- Drop the auto-created customers rows; nurses don't need them.
delete from public.customers
 where profile_id in (
   '00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000202',
   '00000000-0000-4000-8000-000000000203'
 );

-- Promote the profiles role and patch fields to match the frontend mock.
update public.profiles
   set role = 'nurse', full_name = 'محمد الأحمد', phone = '+963911111111',
       photo_url = 'https://picsum.photos/seed/makhbartak-nur1/200/200'
 where id = '00000000-0000-4000-8000-000000000201';
update public.profiles
   set role = 'nurse', full_name = 'سارة السيد',  phone = '+963922222222',
       photo_url = 'https://picsum.photos/seed/makhbartak-nur2/200/200'
 where id = '00000000-0000-4000-8000-000000000202';
update public.profiles
   set role = 'nurse', full_name = 'ليث ناصر',   phone = '+963933333333',
       photo_url = 'https://picsum.photos/seed/makhbartak-nur3/200/200'
 where id = '00000000-0000-4000-8000-000000000203';

insert into public.nurses (id, profile_id, city, is_active)
values
  ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-000000000201', 'دمشق', true),
  ('00000000-0000-4000-8000-0000000a0002', '00000000-0000-4000-8000-000000000202', 'دمشق', true),
  ('00000000-0000-4000-8000-0000000a0003', '00000000-0000-4000-8000-000000000203', 'ريف دمشق', true)
on conflict (id) do nothing;

-- ── nurse_prep_state ───────────────────────────────────────────────────────
-- One row per nurse-per-day. Replaces the localStorage keys
--   makhbartak.nurse.prep:<date>     (checked tool ids)
--   makhbartak.nurse.started:<date>  (boolean flag)
create table if not exists public.nurse_prep_state (
  nurse_id     uuid not null references public.nurses(id) on delete cascade,
  day          date not null,
  started      boolean not null default false,
  checked_ids  text[] not null default '{}',
  updated_at   timestamptz not null default now(),
  primary key (nurse_id, day)
);
create trigger trg_nurse_prep_state_updated_at before update on public.nurse_prep_state
  for each row execute function public.tg_set_updated_at();

-- ── nurse_shortage_requests ────────────────────────────────────────────────
create type public.nurse_shortage_status as enum ('pending', 'acknowledged', 'resolved');

create table if not exists public.nurse_shortage_requests (
  id           uuid primary key default uuid_generate_v4(),
  nurse_id     uuid not null references public.nurses(id) on delete cascade,
  nurse_name   text,
  day          date not null default current_date,
  note         text,
  status       public.nurse_shortage_status not null default 'pending',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by_admin_id   uuid references public.profiles(id) on delete set null,
  resolved_by_admin_name text
);

create table if not exists public.nurse_shortage_request_items (
  id              uuid primary key default uuid_generate_v4(),
  request_id      uuid not null references public.nurse_shortage_requests(id) on delete cascade,
  tool_id         text,
  name_snapshot   text not null,
  quantity        int not null default 1
);

-- ── update_nurse_profile_admin ─────────────────────────────────────────────
create or replace function public.update_nurse_profile_admin(
  p_nurse_id  uuid,
  p_name      text  default null,
  p_city      text  default null,
  p_photo_url text  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  select profile_id into v_profile_id from public.nurses where id = p_nurse_id;
  if v_profile_id is null then
    raise exception 'nurse % does not exist', p_nurse_id;
  end if;

  if p_city is not null then
    update public.nurses set city = p_city, updated_at = now()
     where id = p_nurse_id;
  end if;

  if p_name is not null or p_photo_url is not null then
    update public.profiles
       set full_name = coalesce(p_name, full_name),
           photo_url = coalesce(p_photo_url, photo_url),
           updated_at = now()
     where id = v_profile_id;
  end if;
end;
$$;

revoke all on function public.update_nurse_profile_admin(uuid, text, text, text) from public;
revoke all on function public.update_nurse_profile_admin(uuid, text, text, text) from anon;
revoke all on function public.update_nurse_profile_admin(uuid, text, text, text) from authenticated;

-- ── set_nurse_prep_admin ───────────────────────────────────────────────────
create or replace function public.set_nurse_prep_admin(
  p_nurse_id    uuid,
  p_day         date,
  p_started     boolean,
  p_checked_ids text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.nurses where id = p_nurse_id) then
    raise exception 'nurse % does not exist', p_nurse_id;
  end if;

  insert into public.nurse_prep_state (nurse_id, day, started, checked_ids)
  values (p_nurse_id, p_day, coalesce(p_started, false), coalesce(p_checked_ids, '{}'))
  on conflict (nurse_id, day) do update
    set started = excluded.started,
        checked_ids = excluded.checked_ids,
        updated_at = now();
end;
$$;

revoke all on function public.set_nurse_prep_admin(uuid, date, boolean, text[]) from public;
revoke all on function public.set_nurse_prep_admin(uuid, date, boolean, text[]) from anon;
revoke all on function public.set_nurse_prep_admin(uuid, date, boolean, text[]) from authenticated;

-- ── submit_shortage_request_admin ──────────────────────────────────────────
-- Atomic insert: request + N items. p_items is a jsonb array of
--   { "tool_id": text|null, "name_snapshot": text, "quantity": int }
create or replace function public.submit_shortage_request_admin(
  p_nurse_id   uuid,
  p_nurse_name text,
  p_day        date,
  p_note       text,
  p_items      jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_item jsonb;
begin
  if not exists (select 1 from public.nurses where id = p_nurse_id) then
    raise exception 'nurse % does not exist', p_nurse_id;
  end if;

  insert into public.nurse_shortage_requests (nurse_id, nurse_name, day, note)
  values (p_nurse_id, p_nurse_name, coalesce(p_day, current_date), nullif(trim(p_note), ''))
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.nurse_shortage_request_items (request_id, tool_id, name_snapshot, quantity)
    values (
      v_id,
      nullif(v_item->>'tool_id', ''),
      coalesce(v_item->>'name_snapshot', '—'),
      coalesce((v_item->>'quantity')::int, 1)
    );
  end loop;

  return v_id;
end;
$$;

revoke all on function public.submit_shortage_request_admin(uuid, text, date, text, jsonb) from public;
revoke all on function public.submit_shortage_request_admin(uuid, text, date, text, jsonb) from anon;
revoke all on function public.submit_shortage_request_admin(uuid, text, date, text, jsonb) from authenticated;

-- ── set_shortage_request_status_admin ──────────────────────────────────────
create or replace function public.set_shortage_request_status_admin(
  p_request_id   uuid,
  p_status       public.nurse_shortage_status,
  p_admin_id     uuid    default null,
  p_admin_name   text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.nurse_shortage_requests where id = p_request_id) then
    raise exception 'shortage request % does not exist', p_request_id;
  end if;

  update public.nurse_shortage_requests
     set status = p_status,
         resolved_at = case when p_status = 'resolved' then now() else null end,
         resolved_by_admin_id = case when p_status = 'resolved' then p_admin_id else null end,
         resolved_by_admin_name = case when p_status = 'resolved' then p_admin_name else null end
   where id = p_request_id;
end;
$$;

revoke all on function public.set_shortage_request_status_admin(uuid, public.nurse_shortage_status, uuid, text) from public;
revoke all on function public.set_shortage_request_status_admin(uuid, public.nurse_shortage_status, uuid, text) from anon;
revoke all on function public.set_shortage_request_status_admin(uuid, public.nurse_shortage_status, uuid, text) from authenticated;
