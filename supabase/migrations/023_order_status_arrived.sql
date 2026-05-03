-- ============================================================================
-- 023_order_status_arrived.sql
-- Adds an `arrived` value to public.order_status so the nurse "وصلت" tap is
-- a real state change, not a no-op rewrite of the previous `nurse_on_way`.
-- Idempotent: ALTER TYPE ... ADD VALUE IF NOT EXISTS exists since pg14.
-- Apply via:
--   * Supabase Dashboard → SQL Editor → Run
--   * or `supabase db push`
-- ============================================================================

alter type public.order_status add value if not exists 'arrived' before 'sample_collected';
