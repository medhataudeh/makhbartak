-- ============================================================================
-- 028_phase35_hardening.sql
-- Phase 3.5 — Product Hardening:
--   1) Server-side payment gate on sample_collected.
--   2) Finance preparation columns on app_settings.
-- ============================================================================

-- ── 1) Payment-gated status transitions ────────────────────────────────────
-- Refuse to advance an order to `sample_collected` (or any later lifecycle
-- step) when the order is online + unpaid. Cash orders pass through; cash
-- collection is recorded by /api/orders/[id]/payment-status before the
-- nurse confirms the sample, which is enforced client-side AND here.
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
  v_method  public.payment_method;
  v_status  public.payment_status;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;

  -- Payment gate: lifecycle past sample_collected requires payment when the
  -- order is online. Cash orders are gated by the admin allow_cash_orders
  -- flag at the assignment layer; here we only block online-unpaid.
  if p_status in ('sample_collected', 'sent_to_lab', 'lab_processing',
                  'result_ready', 'completed') then
    select payment_method, payment_status
      into v_method, v_status
      from public.orders where id = p_order_id;
    if v_method = 'online' and v_status is distinct from 'paid' then
      raise exception 'order % is online but unpaid; cannot advance to %', p_order_id, p_status
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

-- ── 2) Finance preparation: Stripe settings on app_settings ────────────────
-- Phase 4 will read these. Phase 3.5 only reserves the columns + admin
-- editing surface so the eventual switch is a config flip, not a schema
-- migration.
do $$ begin
  alter table public.app_settings add column if not exists enable_stripe boolean not null default false;
  alter table public.app_settings add column if not exists stripe_public_key text;
  alter table public.app_settings add column if not exists stripe_mode text not null default 'test'
    check (stripe_mode in ('test', 'live'));
exception when duplicate_column then null; end $$;

-- Extend the existing update_app_settings_admin to forward the new fields.
-- The RPC keeps the (p_patch jsonb) shape; new keys are picked up here.
create or replace function public.update_app_settings_admin(p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.app_settings
     set min_booking_notice_minutes = coalesce((p_patch->>'min_booking_notice_minutes')::int,         min_booking_notice_minutes),
         morning_shift_start        = coalesce(p_patch->>'morning_shift_start',                      morning_shift_start),
         morning_shift_end          = coalesce(p_patch->>'morning_shift_end',                        morning_shift_end),
         evening_shift_start        = coalesce(p_patch->>'evening_shift_start',                      evening_shift_start),
         evening_shift_end          = coalesce(p_patch->>'evening_shift_end',                        evening_shift_end),
         supported_cities           = coalesce(
                                        case when p_patch ? 'supported_cities'
                                             then array(select jsonb_array_elements_text(p_patch->'supported_cities'))
                                             else null end,
                                        supported_cities),
         whatsapp_number            = coalesce(p_patch->>'whatsapp_number',                          whatsapp_number),
         allow_cash_orders          = coalesce((p_patch->>'allow_cash_orders')::boolean,             allow_cash_orders),
         booking_horizon_days       = coalesce((p_patch->>'booking_horizon_days')::int,              booking_horizon_days),
         max_orders_per_shift       = coalesce((p_patch->>'max_orders_per_shift')::int,              max_orders_per_shift),
         enable_stripe              = coalesce((p_patch->>'enable_stripe')::boolean,                 enable_stripe),
         stripe_public_key          = coalesce(p_patch->>'stripe_public_key',                        stripe_public_key),
         stripe_mode                = coalesce(p_patch->>'stripe_mode',                              stripe_mode),
         updated_at                 = now()
   where id = 1;
end;
$$;
