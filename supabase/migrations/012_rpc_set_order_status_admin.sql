-- ============================================================================
-- 012_rpc_set_order_status_admin.sql
-- Phase 2: status update path for the mock-auth + service-role world.
--
-- The existing set_order_status RPC (008) reads auth.uid() to populate
-- actor_id / actor_role on the history row. With mock auth there is no
-- Supabase session, so the API route in src/app/api/orders/[id]/status/
-- calls this admin variant instead — passing the actor explicitly.
--
-- Service-role only. Browser must never invoke this RPC directly.
-- When real Supabase Auth lands, the route handler shrinks to a passthrough
-- (or is removed) and writes happen via the original set_order_status RPC.
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
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;

  update public.orders
     set status = p_status,
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

-- Service-role only. No grants to anon / authenticated. The Next.js API
-- route at /api/orders/[id]/status holds the service-role key server-side
-- and is the sole caller.
revoke all on function public.set_order_status_admin(uuid, public.order_status, public.user_role, uuid, text, text) from public;
revoke all on function public.set_order_status_admin(uuid, public.order_status, public.user_role, uuid, text, text) from anon;
revoke all on function public.set_order_status_admin(uuid, public.order_status, public.user_role, uuid, text, text) from authenticated;
