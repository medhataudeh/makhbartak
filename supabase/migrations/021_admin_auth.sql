-- ============================================================================
-- 021_admin_auth.sql
-- Phase 8.0: real Supabase Auth — admin seed + admin sub-role storage.
--
-- 1. New enum public.admin_role with the six AdminRole values.
-- 2. Add nullable column profiles.admin_role (populated only when role='admin').
-- 3. Seed six demo admin auth.users; the handle_new_user trigger auto-creates
--    profiles + customers; we patch profiles.role='admin' + admin_role and
--    drop the auto-created customers rows.
--
-- This migration is additive. Earlier migrations are not edited.
-- The matching frontend ids live in src/lib/mock-data.ts as constants:
--   SEED_ADMIN_*_PROFILE_ID  ↔ matching auth.users.id
--
-- Demo password (single value across the six admin accounts):
--   phase8-admin-demo-password-do-not-use
-- Documented for staging only. Rotate via auth.admin.updateUserById on pilot.
-- ============================================================================

-- ── admin_role enum ────────────────────────────────────────────────────────
do $$ begin
  create type public.admin_role as enum (
    'super_admin', 'operations_admin', 'lab_admin',
    'customer_support', 'finance_admin', 'content_admin'
  );
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists admin_role public.admin_role;

-- ── Seed admin auth.users ──────────────────────────────────────────────────
-- Pattern matches migrations 010 (customers) and 016 (nurses).
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000000301',
   'admin@phase8.invalid',
   crypt('phase8-admin-demo-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"مدير النظام"}'::jsonb,
   now(), now()),
  ('00000000-0000-4000-8000-000000000302',
   'ops@phase8.invalid',
   crypt('phase8-admin-demo-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"ليلى الحسن"}'::jsonb,
   now(), now()),
  ('00000000-0000-4000-8000-000000000303',
   'lab@phase8.invalid',
   crypt('phase8-admin-demo-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"د. عمر زين"}'::jsonb,
   now(), now()),
  ('00000000-0000-4000-8000-000000000304',
   'support@phase8.invalid',
   crypt('phase8-admin-demo-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"نور الخطيب"}'::jsonb,
   now(), now()),
  ('00000000-0000-4000-8000-000000000305',
   'finance@phase8.invalid',
   crypt('phase8-admin-demo-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"ريم الحلبي"}'::jsonb,
   now(), now()),
  ('00000000-0000-4000-8000-000000000306',
   'content@phase8.invalid',
   crypt('phase8-admin-demo-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"كرم الديب"}'::jsonb,
   now(), now())
on conflict (id) do nothing;

-- The handle_new_user trigger (002:691) auto-created a profiles row with
-- role='customer' and a customers extension row. Drop the customers rows;
-- patch the profiles to role='admin' and set admin_role.

delete from public.customers
 where profile_id in (
   '00000000-0000-4000-8000-000000000301',
   '00000000-0000-4000-8000-000000000302',
   '00000000-0000-4000-8000-000000000303',
   '00000000-0000-4000-8000-000000000304',
   '00000000-0000-4000-8000-000000000305',
   '00000000-0000-4000-8000-000000000306'
 );

update public.profiles
   set role = 'admin', admin_role = 'super_admin',
       full_name = 'مدير النظام'
 where id = '00000000-0000-4000-8000-000000000301';

update public.profiles
   set role = 'admin', admin_role = 'operations_admin',
       full_name = 'ليلى الحسن'
 where id = '00000000-0000-4000-8000-000000000302';

update public.profiles
   set role = 'admin', admin_role = 'lab_admin',
       full_name = 'د. عمر زين'
 where id = '00000000-0000-4000-8000-000000000303';

update public.profiles
   set role = 'admin', admin_role = 'customer_support',
       full_name = 'نور الخطيب'
 where id = '00000000-0000-4000-8000-000000000304';

update public.profiles
   set role = 'admin', admin_role = 'finance_admin',
       full_name = 'ريم الحلبي'
 where id = '00000000-0000-4000-8000-000000000305';

update public.profiles
   set role = 'admin', admin_role = 'content_admin',
       full_name = 'كرم الديب'
 where id = '00000000-0000-4000-8000-000000000306';
