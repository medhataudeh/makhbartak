-- ============================================================================
-- 027_gamification_adjust.sql
-- Phase 3 production hardening:
--   * adjust_nurse_gamification_points_admin RPC — admins add or subtract
--     points on a single nurse's row. Auto-creates the row if missing so
--     newly-imported nurses can be adjusted before their first GET.
--   * Result returns the patched row so the admin client can mirror it
--     locally without a follow-up SELECT.
-- ============================================================================

create or replace function public.adjust_nurse_gamification_points_admin(
  p_nurse_id  uuid,
  p_delta     int
)
returns public.nurse_gamification
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.nurse_gamification;
begin
  if p_nurse_id is null then
    raise exception 'nurse_id is required';
  end if;
  if p_delta is null then
    raise exception 'delta is required';
  end if;
  if not exists (select 1 from public.nurses where id = p_nurse_id) then
    raise exception 'nurse % not found', p_nurse_id;
  end if;
  -- Ensure the row exists so admin can adjust before the nurse has logged in.
  insert into public.nurse_gamification (nurse_id)
  values (p_nurse_id)
  on conflict (nurse_id) do nothing;

  update public.nurse_gamification
     set total_points = greatest(0, total_points + p_delta),
         updated_at = now()
   where nurse_id = p_nurse_id
   returning * into v_row;
  return v_row;
end;
$$;
