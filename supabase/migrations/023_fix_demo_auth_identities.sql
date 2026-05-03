-- ============================================================================
-- 023_fix_demo_auth_identities.sql
-- Phase 8 follow-up: backfill auth.identities for the demo auth.users seeded
-- across migrations 010 (customers), 016 (nurses), 021 (admins), 022 (labs).
--
-- Problem: those earlier migrations inserted into auth.users without inserting
-- the matching auth.identities row. signInWithPassword on Supabase relies on
-- auth.identities (provider='email') to resolve the credential; without it
-- login silently fails even though the password hash is valid.
--
-- This migration:
--   1. Re-asserts the bcrypt password hash for every demo email so existing
--      rows that drifted (or never received a hash) are usable.
--   2. Inserts a provider='email' identity row for every listed demo user
--      where one does not already exist. Existing identities are left alone.
--
-- Idempotent: re-running is a no-op if every user already has a matching
-- identity. Earlier migrations are NOT edited.
-- ============================================================================

-- ── 1. Re-assert demo passwords ───────────────────────────────────────────
-- One UPDATE per password group keeps the migration self-contained and
-- safe — nothing here ever stores a plaintext password in a public table.
update auth.users
   set encrypted_password = crypt('phase1-mock-password-do-not-use', gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at = now()
 where email in ('customer1@phase1.invalid', 'customer2@phase1.invalid');

update auth.users
   set encrypted_password = crypt('phase3-mock-password-do-not-use', gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at = now()
 where email in (
   'nurse1@phase3.invalid', 'nurse2@phase3.invalid', 'nurse3@phase3.invalid'
 );

update auth.users
   set encrypted_password = crypt('phase8-admin-demo-password-do-not-use', gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at = now()
 where email in (
   'admin@phase8.invalid', 'ops@phase8.invalid', 'lab@phase8.invalid',
   'support@phase8.invalid', 'finance@phase8.invalid', 'content@phase8.invalid'
 );

update auth.users
   set encrypted_password = crypt('phase8-lab-demo-password-do-not-use', gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at = now()
 where email in (
   'sham-admin@phase8.invalid', 'sham-acct@phase8.invalid',
   'noor-admin@phase8.invalid', 'noor-acct@phase8.invalid'
 );

-- ── 2. Backfill auth.identities (provider='email') ────────────────────────
-- We insert one row per listed demo user that does not already have an
-- email-provider identity. Existing identities (any provider) are preserved.
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

-- ── 3. Verification query (run manually after migration) ──────────────────
-- select u.email, i.provider, i.provider_id, i.user_id
--   from auth.users u
--   join auth.identities i on i.user_id = u.id
--  where u.email like '%phase%.invalid'
--  order by u.email;
