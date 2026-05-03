-- ============================================================================
-- 014_auto_assign.sql
-- Stage A: nurse + lab assignment for the mock-auth + service-role world.
--
-- Three additive RPCs:
--   * assign_nurse_admin       — manual override by admin (or auto wrapper)
--   * assign_lab_admin         — same for lab
--   * auto_assign_order        — runs both rules; returns the chosen ids
--
-- All three are service-role only. Browser must never invoke them directly.
-- The /api/orders POST handler calls auto_assign_order after place_order_admin
-- so every newly-created order has nurse_id + lab_id populated when possible.
--
-- Replaces the broken Phase-2 client-side assignNurse → writeRemote path
-- (which silently failed under mock auth because auth.getUser() is null).
-- ============================================================================

-- ── assign_nurse_admin ──────────────────────────────────────────────────────
-- Updates orders.nurse_id and appends an order_status_history row with the
-- current status (no transition) so the admin/customer/lab timeline records
-- the assignment. Note prefix conveys the intent:
--   'auto:nurse'    when called by auto_assign_order
--   'manual:nurse'  when called by admin override
create or replace function public.assign_nurse_admin(
  p_order_id    uuid,
  p_nurse_id    uuid,
  p_actor_role  public.user_role,
  p_actor_id    uuid    default null,
  p_actor_name  text    default null,
  p_note        text    default 'manual:nurse'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.order_status;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;
  if p_nurse_id is not null
     and not exists (select 1 from public.nurses where id = p_nurse_id) then
    raise exception 'nurse % does not exist', p_nurse_id;
  end if;

  update public.orders
     set nurse_id = p_nurse_id,
         updated_at = now()
   where id = p_order_id
   returning status into v_status;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_status, p_actor_role, p_actor_id, p_actor_name, p_note
  );
end;
$$;

revoke all on function public.assign_nurse_admin(uuid, uuid, public.user_role, uuid, text, text) from public;
revoke all on function public.assign_nurse_admin(uuid, uuid, public.user_role, uuid, text, text) from anon;
revoke all on function public.assign_nurse_admin(uuid, uuid, public.user_role, uuid, text, text) from authenticated;

-- ── assign_lab_admin ────────────────────────────────────────────────────────
create or replace function public.assign_lab_admin(
  p_order_id    uuid,
  p_lab_id      uuid,
  p_actor_role  public.user_role,
  p_actor_id    uuid    default null,
  p_actor_name  text    default null,
  p_note        text    default 'manual:lab'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.order_status;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;
  if p_lab_id is not null
     and not exists (select 1 from public.labs where id = p_lab_id) then
    raise exception 'lab % does not exist', p_lab_id;
  end if;

  update public.orders
     set lab_id = p_lab_id,
         updated_at = now()
   where id = p_order_id
   returning status into v_status;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_status, p_actor_role, p_actor_id, p_actor_name, p_note
  );
end;
$$;

revoke all on function public.assign_lab_admin(uuid, uuid, public.user_role, uuid, text, text) from public;
revoke all on function public.assign_lab_admin(uuid, uuid, public.user_role, uuid, text, text) from anon;
revoke all on function public.assign_lab_admin(uuid, uuid, public.user_role, uuid, text, text) from authenticated;

-- ── auto_assign_order ───────────────────────────────────────────────────────
-- Picks a nurse + lab using the order's address city, visit date, and shift.
--
-- Nurse rule (in order):
--   1. active nurses whose city matches the order address, ranked by current
--      load on that (visit_date, shift) — least loaded wins. Tie-break by id.
--   2. fallback: any active nurse, same load ranking.
-- If no active nurse exists at all, nurse_id stays null.
--
-- Lab rule (in order):
--   1. active labs whose supported_cities contains the order address city.
--   2. fallback: active labs whose city matches the order address city.
--   3. fallback: any active lab.
-- Tie-break by id ascending. If no active lab exists, lab_id stays null.
--
-- Calls assign_nurse_admin / assign_lab_admin internally so the audit-trail
-- pattern stays unified. Notes are prefixed 'auto:' for telemetry.
create or replace function public.auto_assign_order(
  p_order_id uuid
)
returns table(nurse_id uuid, lab_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city        text;
  v_visit_date  date;
  v_shift       public.shift_window;
  v_existing_n  uuid;
  v_existing_l  uuid;
  v_nurse_id    uuid;
  v_lab_id      uuid;
begin
  -- Resolve the order context.
  select a.city, o.visit_date, o.shift, o.nurse_id, o.lab_id
    into v_city, v_visit_date, v_shift, v_existing_n, v_existing_l
    from public.orders o
    join public.addresses a on a.id = o.address_id
   where o.id = p_order_id;

  if v_visit_date is null then
    raise exception 'order % does not exist', p_order_id;
  end if;

  -- Nurse: only pick if the order doesn't already have one.
  if v_existing_n is null then
    -- Same-city candidates first, ranked by load.
    select n.id into v_nurse_id
      from public.nurses n
      left join public.orders o2
             on o2.nurse_id = n.id
            and o2.visit_date = v_visit_date
            and o2.shift = v_shift
            and o2.deleted_at is null
     where n.is_active
       and n.deleted_at is null
       and n.city = v_city
     group by n.id
     order by count(o2.id) asc, n.id asc
     limit 1;

    -- Fallback: any active nurse, same load ranking.
    if v_nurse_id is null then
      select n.id into v_nurse_id
        from public.nurses n
        left join public.orders o2
               on o2.nurse_id = n.id
              and o2.visit_date = v_visit_date
              and o2.shift = v_shift
              and o2.deleted_at is null
       where n.is_active
         and n.deleted_at is null
       group by n.id
       order by count(o2.id) asc, n.id asc
       limit 1;
    end if;

    if v_nurse_id is not null then
      perform public.assign_nurse_admin(
        p_order_id, v_nurse_id, 'admin', null, 'تخصيص تلقائي', 'auto:nurse'
      );
    end if;
  else
    v_nurse_id := v_existing_n;
  end if;

  -- Lab: only pick if the order doesn't already have one.
  if v_existing_l is null then
    -- Supported-cities array match first.
    select l.id into v_lab_id
      from public.labs l
     where l.is_active
       and l.deleted_at is null
       and v_city = any(l.supported_cities)
     order by l.id asc
     limit 1;

    -- Fallback 1: same-city.
    if v_lab_id is null then
      select l.id into v_lab_id
        from public.labs l
       where l.is_active
         and l.deleted_at is null
         and l.city = v_city
       order by l.id asc
       limit 1;
    end if;

    -- Fallback 2: any active lab.
    if v_lab_id is null then
      select l.id into v_lab_id
        from public.labs l
       where l.is_active
         and l.deleted_at is null
       order by l.id asc
       limit 1;
    end if;

    if v_lab_id is not null then
      perform public.assign_lab_admin(
        p_order_id, v_lab_id, 'admin', null, 'تخصيص تلقائي', 'auto:lab'
      );
    end if;
  else
    v_lab_id := v_existing_l;
  end if;

  nurse_id := v_nurse_id;
  lab_id   := v_lab_id;
  return next;
end;
$$;

revoke all on function public.auto_assign_order(uuid) from public;
revoke all on function public.auto_assign_order(uuid) from anon;
revoke all on function public.auto_assign_order(uuid) from authenticated;
