-- ============================================================================
-- 024_fix_demo_auth_user_metadata.sql
-- Phase 8 follow-up #2: signInWithPassword still rejected the demo accounts
-- after migration 023 because some seeded auth.users rows were missing the
-- aud/role/raw_app_meta_data values Supabase Auth requires.
--
-- This migration:
--   1. Forces aud='authenticated', role='authenticated', and the email
--      provider metadata blob on every demo user.
--   2. Re-asserts the bcrypt password hash so any drifted row is usable.
--   3. Re-asserts the auth.identities row (provider='email') in case 023
--      ran against a partial set or new demo emails were added.
--
-- Idempotent: re-running is a no-op once every row has the expected shape.
-- Migrations 001–023 are NOT edited.
-- ============================================================================

-- ── 1. Patch auth.users metadata for every demo email ─────────────────────
update auth.users
   set aud = 'authenticated',
       role = 'authenticated',
       raw_app_meta_data = jsonb_build_object(
         'provider',  'email',
         'providers', jsonb_build_array('email')
       ),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at = now()
 where email in (
   'customer1@phase1.invalid', 'customer2@phase1.invalid',
   'nurse1@phase3.invalid', 'nurse2@phase3.invalid', 'nurse3@phase3.invalid',
   'admin@phase8.invalid', 'ops@phase8.invalid', 'lab@phase8.invalid',
   'support@phase8.invalid', 'finance@phase8.invalid', 'content@phase8.invalid',
   'sham-admin@phase8.invalid', 'sham-acct@phase8.invalid',
   'noor-admin@phase8.invalid', 'noor-acct@phase8.invalid'
 );

-- ── 2. Re-assert demo passwords (group-by-group) ──────────────────────────
update auth.users
   set encrypted_password = crypt('phase1-mock-password-do-not-use', gen_salt('bf')),
       updated_at = now()
 where email in ('customer1@phase1.invalid', 'customer2@phase1.invalid');

update auth.users
   set encrypted_password = crypt('phase3-mock-password-do-not-use', gen_salt('bf')),
       updated_at = now()
 where email in (
   'nurse1@phase3.invalid', 'nurse2@phase3.invalid', 'nurse3@phase3.invalid'
 );

update auth.users
   set encrypted_password = crypt('phase8-admin-demo-password-do-not-use', gen_salt('bf')),
       updated_at = now()
 where email in (
   'admin@phase8.invalid', 'ops@phase8.invalid', 'lab@phase8.invalid',
   'support@phase8.invalid', 'finance@phase8.invalid', 'content@phase8.invalid'
 );

update auth.users
   set encrypted_password = crypt('phase8-lab-demo-password-do-not-use', gen_salt('bf')),
       updated_at = now()
 where email in (
   'sham-admin@phase8.invalid', 'sham-acct@phase8.invalid',
   'noor-admin@phase8.invalid', 'noor-acct@phase8.invalid'
 );

-- ── 3. Ensure auth.identities (provider='email') exists for each demo user
insert into auth.identities (
  id, user_id, provider, provider_id, identity_data,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  u.id,
  'email',
  u.id::text,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  null,
  now(),
  now()
from auth.users u
where u.email in (
  'customer1@phase1.invalid', 'customer2@phase1.invalid',
  'nurse1@phase3.invalid', 'nurse2@phase3.invalid', 'nurse3@phase3.invalid',
  'admin@phase8.invalid', 'ops@phase8.invalid', 'lab@phase8.invalid',
  'support@phase8.invalid', 'finance@phase8.invalid', 'content@phase8.invalid',
  'sham-admin@phase8.invalid', 'sham-acct@phase8.invalid',
  'noor-admin@phase8.invalid', 'noor-acct@phase8.invalid'
)
  and not exists (
    select 1
      from auth.identities i
     where i.user_id = u.id
       and i.provider = 'email'
  );

-- ── 4. Verification (run manually) ────────────────────────────────────────
-- select u.email, u.aud, u.role, u.raw_app_meta_data,
--        i.provider, i.provider_id
--   from auth.users u
--   join auth.identities i on i.user_id = u.id
--  where u.email like '%phase%.invalid'
--    and i.provider = 'email'
--  order by u.email;
