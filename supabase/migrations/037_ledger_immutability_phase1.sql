-- ============================================================================
-- 037_ledger_immutability_phase1.sql
-- Phase 1 of the ledger-immutability rollout. Locks the four tables that
-- are already append-only by code today, so a future bug or refactor cannot
-- silently introduce direct UPDATE/DELETE on:
--
--   * nurse_wallet_transactions  (mig 031 / 032 / 033)
--   * lab_wallet_transactions    (mig 036)
--   * order_status_history       (mig 002 + every status RPC)
--   * admin_activity_logs        (mig 020)
--
-- Mechanism — current_user gate
-- ─────────────────────────────
-- Every API route reaches the database as the Supabase `service_role`
-- connection (`getSupabaseAdmin()` → service-role JWT). RPCs in this
-- codebase are SECURITY DEFINER and owned by the migration runner role
-- (NOT service_role), so inside an RPC body `current_user` is the
-- function owner. The trigger raises only when the effective caller is
-- service_role — which by construction is exactly the surface we want
-- to lock (direct table writes from the application layer).
--
-- This deliberately preserves every legitimate path:
--   * INSERTs continue to work from RPCs and (rarely) from direct route
--     writes; this trigger only fires BEFORE UPDATE OR DELETE.
--   * RPC-issued UPDATE/DELETE on these tables would also pass — but no
--     RPC currently does either on these four tables (verified in the
--     Phase 1 audit).
--   * Emergency operator intervention from a non-service_role superuser
--     session (e.g. the Supabase SQL editor connected as `postgres`)
--     bypasses the trigger as designed.
--
-- Idempotency
-- ───────────
-- `create or replace function`, `drop trigger if exists` + `create trigger`,
-- and the per-table installs are wrapped so repeated migration runs are
-- no-ops.
--
-- Rollback
-- ────────
-- Drop the triggers; the function may stay (no dangling references). A
-- rollback migration would be a one-liner per trigger:
--   drop trigger if exists trg_lock_<table> on public.<table>;
--
-- Phase 2 (payments + settlements) and Phase 3 (payment_provider_events
-- after the webhook is refactored) reuse this same function.
-- ============================================================================

-- ── Trigger function ────────────────────────────────────────────────────────
-- security invoker (default for plpgsql) — we MUST evaluate the caller's
-- effective current_user, not the function owner. Marking this SECURITY
-- DEFINER would defeat the gate and allow service-role direct writes.
create or replace function public.tg_block_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'service_role' then
    raise exception 'direct % on % is forbidden; mutate via the SECURITY DEFINER RPC',
      tg_op, tg_table_name
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.tg_block_ledger_mutation() from public, anon, authenticated;

-- ── Per-table triggers ─────────────────────────────────────────────────────

do $$ begin
  drop trigger if exists trg_lock_nurse_wallet_transactions
    on public.nurse_wallet_transactions;
  create trigger trg_lock_nurse_wallet_transactions
    before update or delete on public.nurse_wallet_transactions
    for each row execute function public.tg_block_ledger_mutation();
end $$;

do $$ begin
  drop trigger if exists trg_lock_lab_wallet_transactions
    on public.lab_wallet_transactions;
  create trigger trg_lock_lab_wallet_transactions
    before update or delete on public.lab_wallet_transactions
    for each row execute function public.tg_block_ledger_mutation();
end $$;

do $$ begin
  drop trigger if exists trg_lock_order_status_history
    on public.order_status_history;
  create trigger trg_lock_order_status_history
    before update or delete on public.order_status_history
    for each row execute function public.tg_block_ledger_mutation();
end $$;

do $$ begin
  drop trigger if exists trg_lock_admin_activity_logs
    on public.admin_activity_logs;
  create trigger trg_lock_admin_activity_logs
    before update or delete on public.admin_activity_logs
    for each row execute function public.tg_block_ledger_mutation();
end $$;
