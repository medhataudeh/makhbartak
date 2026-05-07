-- ============================================================================
-- 041 — Cross-lab ownership fix for resolve_lab_issue_admin (Phase 5.1).
-- ============================================================================
--
-- Audit finding (Phase 5 lifecycle audit, G1):
--   resolve_lab_issue_admin previously accepted any p_issue_id and resolved
--   it without checking that the caller's lab matched the issue's lab. The
--   route layer also lacked a pre-flight, so a Lab A session could call
--   POST /api/lab-issues/<lab-B-issue-id>/resolve and silently corrupt
--   Lab B's audit trail.
--
-- This migration adds defense-in-depth at the RPC layer. The route is
-- updated alongside in src/app/api/lab-issues/[id]/resolve/route.ts to
-- pre-flight the same ownership invariant; the RPC re-check guarantees
-- correctness even if a future caller forgets the pre-flight.
--
-- Contract for the new p_actor_lab_id parameter:
--   * IS NULL  → skip the check. Admin callers pass null because admins
--                 are not lab-scoped.
--   * NOT NULL → raise unless lab_issues.lab_id = p_actor_lab_id. Lab
--                 callers pass their session.labId and will be refused on
--                 cross-lab attempts.
--
-- Rollback: this migration drops the old 5-arg overload and creates the new
-- 6-arg one. To revert behaviour without reverting the schema, the route
-- can simply omit p_actor_lab_id (it defaults to null → check skipped).
-- Schema rollback would re-create the original mig-017 function body in a
-- follow-up migration; not required for the runtime revert.

drop function if exists public.resolve_lab_issue_admin(uuid, text, public.user_role, uuid, text);

create or replace function public.resolve_lab_issue_admin(
  p_issue_id      uuid,
  p_note          text default null,
  p_actor_role    public.user_role default 'admin',
  p_actor_id      uuid  default null,
  p_actor_name    text  default null,
  p_actor_lab_id  uuid  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_lab_id   uuid;
begin
  select order_id, lab_id into v_order_id, v_lab_id
    from public.lab_issues where id = p_issue_id;
  if v_order_id is null then
    raise exception 'lab issue % does not exist', p_issue_id;
  end if;

  if p_actor_lab_id is not null and v_lab_id is distinct from p_actor_lab_id then
    raise exception 'لا تملك صلاحية حل هذه المشكلة' using errcode = 'P0001';
  end if;

  update public.lab_issues
     set status = 'resolved',
         resolved_at = now(),
         resolved_by_role = p_actor_role,
         resolved_by_id = p_actor_id,
         resolved_by_name = p_actor_name,
         resolution_note = nullif(trim(p_note), ''),
         updated_at = now()
   where id = p_issue_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  select v_order_id, status, p_actor_role, p_actor_id, p_actor_name,
         'lab_issue:resolved' || coalesce(' — ' || nullif(trim(p_note), ''), '')
    from public.orders where id = v_order_id;
end;
$$;

revoke all on function public.resolve_lab_issue_admin(uuid, text, public.user_role, uuid, text, uuid) from public;
revoke all on function public.resolve_lab_issue_admin(uuid, text, public.user_role, uuid, text, uuid) from anon;
revoke all on function public.resolve_lab_issue_admin(uuid, text, public.user_role, uuid, text, uuid) from authenticated;
