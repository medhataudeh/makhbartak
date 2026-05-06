-- ============================================================================
-- 035_phase51_launch_blockers.sql
-- Phase 5.1 — DB invariants + indexes called out by the launch audit.
--
-- Scope (DB-only fixes; the corresponding code changes ride alongside):
--   * payments(provider_ref) unique partial index — webhook lookup fast-path.
--   * admin_activity_logs(action, created_at desc) — admin filter speed.
--   * orders(lower(public_number)) — case-insensitive search.
--   * app_settings: pin singleton to id = 1 (prevent accidental second row).
-- ============================================================================

-- ── payments.provider_ref unique partial ──────────────────────────────────
-- Two payments must never share a provider_ref. The find_payment_by_provider_ref
-- helper depends on a fast unique lookup; without this the webhook seq-scans.
do $$ begin
  -- Defensive: a previous bad webhook replay could in theory have left the same
  -- provider_ref on two rows. Drop dups (older row wins) before the unique
  -- index. There should be zero rows in practice on a clean DB.
  delete from public.payments p
   where p.provider_ref is not null
     and exists (
       select 1 from public.payments q
        where q.provider_ref = p.provider_ref
          and q.id <> p.id
          and q.created_at < p.created_at
     );
exception when undefined_column then null; end $$;

create unique index if not exists payments_provider_ref_unique
  on public.payments(provider_ref) where provider_ref is not null;

-- ── admin_activity_logs(action, created_at desc) ──────────────────────────
create index if not exists admin_activity_logs_action_created
  on public.admin_activity_logs(action, created_at desc);

-- ── orders(lower(public_number)) ──────────────────────────────────────────
create index if not exists orders_public_number_lower
  on public.orders(lower(public_number));

-- ── app_settings singleton constraint ─────────────────────────────────────
-- Already a PK on id with default 1, but no constraint preventing a second row
-- being inserted with id = 2. This catches accidental seed scripts.
do $$ begin
  alter table public.app_settings add constraint app_settings_singleton_id check (id = 1);
exception when duplicate_object then null; when invalid_table_definition then null; end $$;

-- ── Forensic state tags on payment_provider_events ────────────────────────
-- The webhook now retries previously-failed effects when a Stripe replay arrives.
-- We expand the 'result' values via documentation (free-text column, no enum
-- migration needed). Possible values:
--   received        — row inserted, side-effect not yet attempted
--   processed       — first attempt succeeded
--   confirm_error   — confirm RPC failed; replay must retry
--   failed_error    — failed-payment RPC failed; replay must retry
--   refund_error    — refund RPC failed; replay must retry
--   no_match        — no local payment row for the provider_ref
--   ignored         — event type we don't act on
--   duplicate       — replay arriving after a successful prior result
-- The webhook handler treats {confirm_error, failed_error, refund_error} as
-- "retry me" so a second Stripe delivery completes the side effect.
comment on column public.payment_provider_events.result is
  'received | processed | confirm_error | failed_error | refund_error | no_match | ignored | duplicate';
