-- ============================================================================
-- 041_fix_set_order_status_admin_enum_literals.sql
-- Bug fix: migration 029_payment_gate_strict.sql shipped a payment-gate IN
-- list using TS-side status names (`sent_to_lab`, `lab_processing`,
-- `result_ready`) that do NOT exist in the public.order_status enum
-- (canonical SQL values are `received_by_lab`, `processing`,
-- `results_uploaded` — see 001_init_enums.sql + 023_order_status_arrived.sql).
--
-- Effect of the bug: every call to set_order_status_admin raised
--   "invalid input value for enum order_status: \"sent_to_lab\""
-- because Postgres coerces every IN-list literal to the enum type to
-- evaluate the gate. Nurse status updates, lab confirm, and the
-- open_lab_issue_admin → set_order_status_admin chain all crashed.
--
-- This migration is an exact CREATE OR REPLACE of the 029 body with the
-- three invalid literals swapped for their canonical SQL counterparts.
-- The set of gated statuses is unchanged (same five lifecycle steps,
-- just spelled correctly), so the strict payment gate behaves identically
-- to what 029 intended.
--
-- Per the project's migration-ordering invariant, 028 and 029 are NOT
-- edited in place — this new numbered migration supersedes them.
-- ============================================================================

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

  update public.orders
     set status = p_status,
         updated_at = now(),
         completed_at = case when p_status = 'completed' then now() else completed_at end
   where id = p_order_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, p_status, p_actor_role, p_actor_id, p_actor_name, p_note
  );
end;
$$;
