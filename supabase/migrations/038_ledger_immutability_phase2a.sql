-- ============================================================================
-- 038_ledger_immutability_phase2a.sql
-- Phase 2A of the ledger-immutability rollout. Attaches the existing
-- tg_block_ledger_mutation() function (defined in mig 037) as a BEFORE
-- UPDATE OR DELETE trigger on public.payments.
--
-- Why payments is safe to lock now
-- ────────────────────────────────
-- Unlike the four tables locked in Phase 1, payments is NOT append-only —
-- it is a state-machine row mutated through its lifecycle:
--   pending → paid_by_nurse → verified_by_admin → (partially_)refunded
-- Mutations are intrinsic. The Phase 1 audit + the staging pg_proc gate
-- proved every UPDATE comes from a SECURITY DEFINER RPC owned by the
-- migration runner role (NOT service_role). The trigger therefore allows
-- every legitimate path and only blocks the surface we care about: direct
-- table writes from the application layer (route handlers reaching the
-- DB as service_role).
--
-- Allowed paths after this migration (all still pass current_user check):
--   * place_order_admin          — INSERT pending row (trigger does not fire on INSERT)
--   * nurse_collect_cash         — UPDATE pending → paid_by_nurse
--   * admin_record_cash_payment  — UPDATE pending → verified_by_admin
--   * verify_payment_admin       — UPDATE paid_by_nurse → verified_by_admin
--   * start_online_payment_admin — UPDATE pending row with provider snapshot
--   * confirm_online_payment_admin — UPDATE → verified_by_admin (Stripe webhook path)
--   * mark_online_payment_failed — UPDATE → failed
--   * record_provider_refund     — UPDATE → (partially_)refunded
--   * refund_payment_admin       — UPDATE → (partially_)refunded
--   * reverse_cash_collection_admin — UPDATE → refunded (cancel-paid-order path)
--   * set_payment_status_admin   — UPDATE non-paid statuses
--   * apply_coupon_admin         — UPDATE amount on still-pending row
--
-- Blocked paths (intentional):
--   * Any future direct sb.from('payments').update(...) /.delete(...) from
--     a route handler running on the service_role connection. Today there
--     are zero such callsites; the trigger guards against future drift.
--
-- Idempotency
-- ───────────
-- drop trigger if exists … + create trigger. Re-applying is a no-op.
-- The function tg_block_ledger_mutation() is created (or replaced) by
-- mig 037 and reused here unchanged.
--
-- Rollback
-- ────────
--   drop trigger if exists trg_lock_payments on public.payments;
-- The function may stay; it is still used by Phase 1.
-- ============================================================================

do $$ begin
  drop trigger if exists trg_lock_payments on public.payments;
  create trigger trg_lock_payments
    before update or delete on public.payments
    for each row execute function public.tg_block_ledger_mutation();
end $$;
