-- ============================================================================
-- 045 — Drop the dead `orders.completed_at` reference from
--       set_order_status_admin (Phase 5.6 hotfix).
-- ============================================================================
--
-- Production regression observed (2026-05-07):
--   "column completed_at does not exist"
--
-- Root cause: stale logic, NOT schema drift. The orders table (mig 002)
-- defines only `created_at`, `updated_at`, `deleted_at` — there is no
-- `completed_at` column. The column was referenced in
-- set_order_status_admin's UPDATE clause from mig 028 onward
-- (mig 028 → mig 029 → mig 041_fix), but was never added by any
-- migration. Postgres column-resolves the UPDATE at parse time, so
-- every call that reaches the UPDATE crashed with the error above
-- regardless of which p_status was passed.
--
-- Why it took so long to surface:
--   * The strict payment gate (mig 029/041_fix) raises P0001 BEFORE
--     the UPDATE for some inputs, so unpaid-sample-collected and
--     unpaid-completed attempts returned the gate's Arabic message
--     and the UPDATE was never reached.
--   * Cash collection ('arrived' check, "يجب تأكيد الوصول أولاً")
--     comes from a different RPC (`nurse_collect_cash`, mig 031/032/
--     033) that does not touch `completed_at`.
--   * Lifecycle transitions that pass the gate (e.g. arrived on a
--     paid order, completed via lab confirm) all crash.
--
-- Fix decision: REMOVE the dead reference rather than add the column.
--   * No code reads `orders.completed_at` (verified by full-tree grep).
--   * The canonical "when did this order complete" timestamp is
--     `order_status_history.created_at` for the row with status =
--     'completed'. Same data, already recorded, already queryable.
--   * Adding a column would require a backfill of historical orders
--     and ongoing maintenance for a field with no consumer.
--
-- This migration is a CREATE OR REPLACE that is byte-identical to
-- mig 041_fix EXCEPT the offending `completed_at = case ...` line is
-- removed from the UPDATE. Strict payment gate, history insert, and
-- function signature are preserved exactly.
--
-- Rollback: re-apply mig 041_fix's body via a follow-up migration if
-- needed (would re-introduce the crash). The recovery path on
-- production is just to apply 045.

create or replace function public.set_order_status_admin(
  p_order_id    uuid,
  p_status      public.order_status,
  p_actor_role  public.user_role,
  p_actor_id    uuid    default null,
  p_actor_name  text    default null,
  p_note        text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  public.payment_status;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;

  -- Strict payment gate: any advance to sample_collected or later requires
  -- payment_status = 'paid'. Applies equally to cash and online orders.
  -- The Arabic message is the customer-facing copy the route returns.
  -- Canonical SQL enum values only — TS-side names (sent_to_lab /
  -- lab_processing / result_ready) are NEVER valid here. See CLAUDE.md
  -- "TS↔SQL enum boundary" rule.
  if p_status in ('sample_collected', 'received_by_lab', 'processing',
                  'results_uploaded', 'completed') then
    select payment_status
      into v_status
      from public.orders where id = p_order_id;
    if v_status is distinct from 'paid' then
      raise exception 'يجب تأكيد استلام المبلغ قبل متابعة الطلب'
        using errcode = 'P0001';
    end if;
  end if;

  -- P5.6: removed `completed_at = case when p_status = 'completed' then now()
  -- else completed_at end` from the SET list. The column does not exist on
  -- the orders table; the timestamp lives in order_status_history.
  update public.orders
     set status     = p_status,
         updated_at = now()
   where id = p_order_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, p_status, p_actor_role, p_actor_id, p_actor_name, p_note
  );
end;
$$;

revoke all on function public.set_order_status_admin(
  uuid, public.order_status, public.user_role, uuid, text, text) from public;
revoke all on function public.set_order_status_admin(
  uuid, public.order_status, public.user_role, uuid, text, text) from anon;
revoke all on function public.set_order_status_admin(
  uuid, public.order_status, public.user_role, uuid, text, text) from authenticated;
