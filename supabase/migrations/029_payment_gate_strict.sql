-- ============================================================================
-- 029_payment_gate_strict.sql
-- Phase 3.5 follow-up:
--   * set_order_status_admin now blocks the sample_collected → completed
--     range for ANY unpaid order — cash and online both. The previous
--     version only enforced the gate for online orders.
--   * Error message is Arabic so the route handler can surface it directly
--     to the nurse without translation.
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
  if p_status in ('sample_collected', 'sent_to_lab', 'lab_processing',
                  'result_ready', 'completed') then
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
