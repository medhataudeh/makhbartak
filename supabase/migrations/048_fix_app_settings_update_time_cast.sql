-- ============================================================================
-- 048 — Fix update_app_settings_admin: cast shift-time keys to `time`.
-- ============================================================================
--
-- Production bug: EVERY call to update_app_settings_admin (the only writer for
-- app_settings) raised
--   42804: COALESCE types text and time without time zone cannot be matched
-- because the four shift columns (morning_shift_start/end,
-- evening_shift_start/end) are `time without time zone`, but the RPC coalesced
-- the jsonb text extraction (`p_patch->>'...'`, which is text) directly against
-- the time column. Postgres resolves COALESCE arg types at parse time, so the
-- whole UPDATE failed regardless of WHICH key was being patched. Net effect:
-- the admin Settings screen could not persist ANY field — including
-- `nurse_commission_percentage` — so the nurse-commission setting silently
-- "never applied". (The value stayed at its default 0, which disables
-- accrual.)
--
-- Fix: cast the four shift keys to `::time`, identical shape to how the int /
-- boolean / numeric keys were already cast. No column, signature, or
-- field-set change — this is a pure CREATE OR REPLACE that makes the existing
-- contract actually execute.
--
-- Enum-safety: adds no enum values (single-file shape is safe).
-- ============================================================================

create or replace function public.update_app_settings_admin(p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.app_settings
     set min_booking_notice_minutes = coalesce((p_patch->>'min_booking_notice_minutes')::int,         min_booking_notice_minutes),
         morning_shift_start        = coalesce((p_patch->>'morning_shift_start')::time,               morning_shift_start),
         morning_shift_end          = coalesce((p_patch->>'morning_shift_end')::time,                 morning_shift_end),
         evening_shift_start        = coalesce((p_patch->>'evening_shift_start')::time,               evening_shift_start),
         evening_shift_end          = coalesce((p_patch->>'evening_shift_end')::time,                 evening_shift_end),
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
         nurse_commission_percentage = coalesce((p_patch->>'nurse_commission_percentage')::numeric,  nurse_commission_percentage),
         lab_default_payout_type    = coalesce((p_patch->>'lab_default_payout_type')::public.payout_type, lab_default_payout_type),
         lab_default_payout_value   = coalesce((p_patch->>'lab_default_payout_value')::numeric,      lab_default_payout_value),
         updated_at                 = now()
   where id = 1;
end;
$$;
revoke all on function public.update_app_settings_admin(jsonb) from public, anon, authenticated;
