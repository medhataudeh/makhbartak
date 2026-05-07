-- ============================================================================
-- 042 — Verify-patient immutability (Phase 5.2).
-- ============================================================================
--
-- Audit finding (Phase 5 lifecycle audit, G3):
--   verify_patient_admin previously allowed unconditional UPDATE of
--   orders.patient_official_name and orders.patient_national_id. A nurse
--   could re-call the route and silently overwrite the audit-stamped
--   identity. The route had no pre-flight on prior verification, the RPC
--   had no immutability gate, and the NurseApp UI exposed a "تعديل"
--   button that re-opened the verification sheet after lock.
--
-- Verification is now operationally append-only:
--   * The first successful verify stamps identity and writes a
--     'verify_patient' row to order_status_history.
--   * Subsequent verify attempts are refused unless the caller passes
--     p_allow_overwrite=true. The route gates this to admin role only,
--     and only when the body explicitly includes allowOverride=true.
--   * Override events stamp 'verify_patient[override]' in
--     order_status_history so audits can grep them.
--
-- Rollback shape (mirrors P5.1 / mig 041): the new param defaults to
-- TRUE so reverting the route alone restores mig-015 semantics. The new
-- RPC is a strict superset; adding the parameter did not change its
-- default execution path. A schema rollback (043) is only needed if we
-- want to remove the parameter entirely.

drop function if exists public.verify_patient_admin(
  uuid, text, text, text, public.user_role, uuid, text);

create or replace function public.verify_patient_admin(
  p_order_id        uuid,
  p_official_name   text,
  p_national_id     text     default null,
  p_note            text     default null,
  p_actor_role      public.user_role default 'nurse',
  p_actor_id        uuid     default null,
  p_actor_name      text     default null,
  p_allow_overwrite boolean  default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status            public.order_status;
  v_already_verified  boolean;
  v_history_tag       text;
begin
  select status,
         coalesce(patient_official_name, patient_national_id) is not null
    into v_status, v_already_verified
    from public.orders where id = p_order_id;
  if v_status is null then
    raise exception 'order % does not exist', p_order_id;
  end if;

  -- P5.2 — immutability gate. Subsequent verify attempts are refused
  -- unless the caller explicitly opts into overwrite (admin-only path
  -- enforced at the route layer).
  if v_already_verified and not p_allow_overwrite then
    raise exception 'تم التحقق من المريض مسبقاً ولا يمكن تعديله'
      using errcode = 'P0001';
  end if;

  v_history_tag := case
    when v_already_verified then 'verify_patient[override]'
    else 'verify_patient'
  end;

  update public.orders
     set patient_official_name = nullif(trim(p_official_name), ''),
         patient_national_id   = nullif(trim(p_national_id), ''),
         internal_notes        = case
           when nullif(trim(p_note), '') is null then internal_notes
           when internal_notes is null then trim(p_note)
           else internal_notes || E'\n' || trim(p_note)
         end,
         updated_at = now()
   where id = p_order_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_status, p_actor_role, p_actor_id, p_actor_name,
    v_history_tag || coalesce(': ' || nullif(trim(p_note), ''), '')
  );
end;
$$;

revoke all on function public.verify_patient_admin(
  uuid, text, text, text, public.user_role, uuid, text, boolean) from public;
revoke all on function public.verify_patient_admin(
  uuid, text, text, text, public.user_role, uuid, text, boolean) from anon;
revoke all on function public.verify_patient_admin(
  uuid, text, text, text, public.user_role, uuid, text, boolean) from authenticated;
