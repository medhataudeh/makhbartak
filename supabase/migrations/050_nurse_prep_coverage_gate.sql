-- ============================================================================
-- 050 — Server-side nurse prep coverage gate.
-- ============================================================================
--
-- The nurse "بدأت يومي" flow validates prepared >= required on the client, but
-- /api/nurses/[id]/online only checked that a confirmation row EXISTS — a direct
-- API call could go online with under-covered (or zero) prepared quantities.
--
-- This RPC computes the REQUIRED quantities from canonical DB data (today's
-- assigned orders → order_items → lab_test_required_tools where required = true)
-- and compares them against the prepared amounts the nurse recorded in
-- nurse_daily_prep_confirmations.confirmed_items. The /online route calls it
-- before flipping is_online = true for a nurse session.
--
-- Rules:
--   * Only `required = true` tool mappings gate the start (optional tools don't).
--   * Cancelled orders are excluded from the required computation.
--   * If there is NO confirmation row for the day → ok=false, reason
--     'no_confirmation'.
--   * If every required tool is present with prepared >= required → ok=true.
--   * If NO required tools exist for today (no mapping) → required set is empty
--     → ok=true (the existing presence-confirmation behavior stands; nothing to
--     cover). The route still requires a confirmation row to exist.
--
-- Read-only / SECURITY DEFINER (the table has RLS with no policies → service
-- role only). Returns jsonb: { ok, reason, shortfalls:[{toolId,nameAr,unit,
-- required,prepared}] }.
--
-- Enum-safety: adds no enum values; uses only the canonical SQL status literal
-- 'cancelled'. No 55P04 risk.
-- ============================================================================

create or replace function public.check_nurse_prep_coverage(
  p_nurse_id  uuid,
  p_work_date date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items      jsonb;
  v_shortfalls jsonb;
begin
  select confirmed_items
    into v_items
    from public.nurse_daily_prep_confirmations
   where nurse_id = p_nurse_id and work_date = p_work_date;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_confirmation', 'shortfalls', '[]'::jsonb);
  end if;

  with req as (
    select ltrt.nurse_tool_id           as tool_id,
           sum(ltrt.quantity_per_test)::int as required_qty
      from public.orders o
      join public.order_items oi
        on oi.order_id = o.id
      join public.lab_test_required_tools ltrt
        on ltrt.lab_test_id = oi.lab_test_id
     where o.nurse_id   = p_nurse_id
       and o.visit_date = p_work_date
       and o.status <> 'cancelled'
       and ltrt.required = true
     group by ltrt.nurse_tool_id
  ),
  prepared as (
    -- Dedupe by tool id (confirmed_items is free-form jsonb; if a tool appears
    -- more than once, take the largest prepared amount) so the join below yields
    -- exactly one row per required tool.
    select tool_id, max(prepared_qty) as prepared_qty
      from (
        select (elem->>'toolId')::uuid                          as tool_id,
               coalesce(nullif(elem->>'prepared', '')::numeric, 0) as prepared_qty
          from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) as elem
         where elem->>'toolId' is not null
           and elem->>'toolId' ~ '^[0-9a-fA-F-]{36}$'
      ) x
     group by tool_id
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'toolId',   r.tool_id,
               'nameAr',   nt.name_ar,
               'unit',     nt.unit,
               'required', r.required_qty,
               'prepared', coalesce(p.prepared_qty, 0)
             ) order by nt.name_ar
           ),
           '[]'::jsonb
         )
    into v_shortfalls
    from req r
    join public.nurse_tools nt on nt.id = r.tool_id
    left join prepared p on p.tool_id = r.tool_id
   where coalesce(p.prepared_qty, 0) < r.required_qty;

  return jsonb_build_object(
    'ok',         (v_shortfalls = '[]'::jsonb),
    'reason',     case when v_shortfalls = '[]'::jsonb then null else 'insufficient' end,
    'shortfalls', v_shortfalls
  );
end;
$$;
revoke all on function public.check_nurse_prep_coverage(uuid, date) from public, anon, authenticated;
