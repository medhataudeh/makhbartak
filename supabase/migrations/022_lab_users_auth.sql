-- ============================================================================
-- 022_lab_users_auth.sql
-- Phase 8.0: real Supabase Auth — lab user seed.
--
-- Seeds four demo lab users matching the existing MOCK_LAB_USERS:
--   sham-admin / sham-acct → labs.id 77777777-...-001 (مخبر الشام الطبي)
--   noor-admin / noor-acct → labs.id 77777777-...-002 (مخبر النور)
--
-- Each row gets:
--   * auth.users with bcrypt-hashed demo password
--   * profiles auto-created by trigger; we patch role='lab' + full_name
--   * customers row auto-created by trigger; dropped (lab users aren't customers)
--   * lab_users row linking profile_id → lab_id with the lab_user_role
--
-- Demo password (single value for all four):
--   phase8-lab-demo-password-do-not-use
--
-- This migration is additive. Earlier migrations are not edited.
-- The matching frontend ids live in src/lib/mock-data.ts as constants:
--   SEED_LAB_USER_*_PROFILE_ID
--   SEED_LAB_USER_*_LAB_USER_ID
-- ============================================================================

-- ── Seed lab user auth.users ───────────────────────────────────────────────
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000000401',
   'sham-admin@phase8.invalid',
   crypt('phase8-lab-demo-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"د. عمر زين"}'::jsonb,
   now(), now()),
  ('00000000-0000-4000-8000-000000000402',
   'sham-acct@phase8.invalid',
   crypt('phase8-lab-demo-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"هيا الكفري"}'::jsonb,
   now(), now()),
  ('00000000-0000-4000-8000-000000000403',
   'noor-admin@phase8.invalid',
   crypt('phase8-lab-demo-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"د. سارة الحلبي"}'::jsonb,
   now(), now()),
  ('00000000-0000-4000-8000-000000000404',
   'noor-acct@phase8.invalid',
   crypt('phase8-lab-demo-password-do-not-use', gen_salt('bf')),
   now(), 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"ريم القاسم"}'::jsonb,
   now(), now())
on conflict (id) do nothing;

-- Drop trigger-auto-created customers rows; lab users aren't customers.
delete from public.customers
 where profile_id in (
   '00000000-0000-4000-8000-000000000401',
   '00000000-0000-4000-8000-000000000402',
   '00000000-0000-4000-8000-000000000403',
   '00000000-0000-4000-8000-000000000404'
 );

-- Promote profile role + full name.
update public.profiles
   set role = 'lab', full_name = 'د. عمر زين'
 where id = '00000000-0000-4000-8000-000000000401';
update public.profiles
   set role = 'lab', full_name = 'هيا الكفري'
 where id = '00000000-0000-4000-8000-000000000402';
update public.profiles
   set role = 'lab', full_name = 'د. سارة الحلبي'
 where id = '00000000-0000-4000-8000-000000000403';
update public.profiles
   set role = 'lab', full_name = 'ريم القاسم'
 where id = '00000000-0000-4000-8000-000000000404';

-- Insert lab_users with deterministic UUIDs so the frontend constants match.
insert into public.lab_users (id, profile_id, lab_id, role, is_active)
values
  ('00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-000000000401',
   '77777777-7777-7777-7777-000000000001',
   'lab_admin', true),
  ('00000000-0000-4000-8000-00000000b002',
   '00000000-0000-4000-8000-000000000402',
   '77777777-7777-7777-7777-000000000001',
   'lab_accounting', true),
  ('00000000-0000-4000-8000-00000000b003',
   '00000000-0000-4000-8000-000000000403',
   '77777777-7777-7777-7777-000000000002',
   'lab_admin', true),
  ('00000000-0000-4000-8000-00000000b004',
   '00000000-0000-4000-8000-000000000404',
   '77777777-7777-7777-7777-000000000002',
   'lab_accounting', true)
on conflict (id) do nothing;
