-- ============================================================================
-- 040_provider_event_result_rpc.sql
-- PR3.A — additive RPC for the Stripe webhook's payment_provider_events
-- bookkeeping. Lays the groundwork for PR3.B (immutability trigger on the
-- table) by giving the webhook a SECURITY DEFINER channel to issue its
-- nine UPDATE bookkeeping calls without bypassing the trigger we will
-- attach in 041.
--
-- Contract
-- ────────
-- Single multi-purpose updater. The webhook's two distinct UPDATE shapes
-- (set payment_id after the lookup, set result tag after each branch)
-- collapse to one call site by passing one argument or the other:
--
--   * set payment_id only:
--       set_payment_provider_event_result(event_id, p_payment_id => <uuid>)
--   * set result tag only:
--       set_payment_provider_event_result(event_id, p_result => '<tag>')
--   * set both at once (not used today, but trivially supported):
--       set_payment_provider_event_result(event_id, <uuid>, '<tag>')
--
-- COALESCE preserves the existing column value when a parameter is null,
-- so unused parameters never overwrite. Calling the RPC with no payload
-- (both p_payment_id and p_result null) is a harmless no-op.
--
-- Behaviour parity with the direct UPDATEs being replaced
-- ──────────────────────────────────────────────────────
-- Each direct UPDATE today is its own implicit single-statement
-- transaction; this RPC body contains a single UPDATE statement, so the
-- transaction shape is identical. Concurrent calls against the same
-- event_id are last-write-wins, exactly as today. INSERT and SELECT
-- paths are unchanged — the webhook still inserts the event row directly
-- (the 23505 unique-violation IS the canonical dedup mechanism) and
-- still reads the existing row's state via a direct SELECT.
--
-- Security
-- ────────
-- security definer + revoke from public/anon/authenticated matches every
-- other admin RPC in this codebase. After PR3.B attaches the trigger to
-- payment_provider_events, calls to this RPC will run with current_user
-- = function owner (NOT service_role), so the trigger allows them.
-- Direct UPDATEs from any future caller running as service_role will be
-- blocked.
--
-- Idempotency
-- ───────────
-- create or replace function — re-applying is a no-op. No table changes.
--
-- Rollback
-- ────────
-- The function is additive. PR3.A is reversible by reverting the route
-- file alone; this migration can stay (the function is harmless if
-- unused) or be dropped via:
--   drop function if exists public.set_payment_provider_event_result(text, uuid, text);
-- ============================================================================

create or replace function public.set_payment_provider_event_result(
  p_event_id    text,
  p_payment_id  uuid default null,
  p_result      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event_id is null then
    raise exception 'p_event_id is required';
  end if;
  -- COALESCE preserves the row's existing column value when a parameter
  -- is null. UPDATE with no matching row is a harmless no-op (the
  -- webhook never reaches this RPC without a row already in place).
  update public.payment_provider_events
     set payment_id = coalesce(p_payment_id, payment_id),
         result     = coalesce(p_result,     result)
   where id = p_event_id;
end;
$$;

revoke all on function public.set_payment_provider_event_result(text, uuid, text)
  from public, anon, authenticated;
