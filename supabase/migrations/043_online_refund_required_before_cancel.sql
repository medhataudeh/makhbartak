-- ============================================================================
-- 043 — Online refund integrity for cancel_order_admin (Phase 5.5).
-- ============================================================================
--
-- Audit finding (Phase 5 lifecycle audit, F1 / S1):
--   cancel_order_admin previously flipped any paid order to "refunded"
--   server-side via reverse_cash_collection_admin. For ONLINE payments
--   this only updated payments.status + orders.payment_status; no Stripe
--   API call was made. Result: customer charged, order cancelled, server
--   says "refunded", Stripe still holds the money. The customer would
--   never see their refund unless the admin separately invoked the
--   refund flow.
--
-- This migration enforces an explicit operational sequence:
--   1. Admin executes refund first (Stripe Dashboard → webhook
--      record_provider_refund, OR /api/admin/payments/[id]/refund →
--      refund_payment_admin).
--   2. Admin cancels second.
--
-- The cancel RPC now refuses while an online-paid payment row is still
-- in a money-owed state. Cash payments are unaffected — RCC continues
-- to debit the nurse wallet and flip the cash payment to refunded in
-- one transaction. No Stripe API call is introduced into the cancel
-- path; cancel does not couple to the provider.
--
-- Rollback shape (mirrors mig 041 / 042): the new param defaults to
-- FALSE so reverting the route alone restores mig-032 semantics.

drop function if exists public.cancel_order_admin(
  uuid, text, public.user_role, uuid, text);

create or replace function public.cancel_order_admin(
  p_order_id     uuid,
  p_reason       text,
  p_actor_role   public.user_role,
  p_actor_id     uuid    default null,
  p_actor_name   text    default null,
  p_refuse_if_unrefunded_online boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.payment_status;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;

  -- P5.5 — online refund integrity. Refuse cancellation while any online
  -- payment row is still in a money-owed status. The admin must run the
  -- refund flow first; once payments.status = 'refunded' (full) for the
  -- online row, this guard passes. Cash payments fall outside this
  -- predicate (method='cash') and are handled by RCC below.
  if p_refuse_if_unrefunded_online and exists (
    select 1 from public.payments
     where order_id = p_order_id
       and method = 'online'
       and status in (
         'paid', 'paid_by_nurse', 'verified_by_admin', 'partially_refunded'
       )
  ) then
    raise exception 'يجب تنفيذ الاسترداد أولاً قبل إلغاء الطلب'
      using errcode = 'P0001';
  end if;

  select payment_status into v_status from public.orders where id = p_order_id;
  if v_status = 'paid' then
    perform public.reverse_cash_collection_admin(
      p_order_id, p_actor_id, p_actor_name, p_reason);
  end if;

  update public.orders
     set status = 'cancelled', updated_at = now()
   where id = p_order_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, 'cancelled', p_actor_role, p_actor_id, p_actor_name,
    'cancel' || coalesce(': ' || nullif(trim(p_reason), ''), '')
  );
end;
$$;

revoke all on function public.cancel_order_admin(
  uuid, text, public.user_role, uuid, text, boolean) from public;
revoke all on function public.cancel_order_admin(
  uuid, text, public.user_role, uuid, text, boolean) from anon;
revoke all on function public.cancel_order_admin(
  uuid, text, public.user_role, uuid, text, boolean) from authenticated;
