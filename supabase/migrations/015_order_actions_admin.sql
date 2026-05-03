-- ============================================================================
-- 015_order_actions_admin.sql
-- Stage B: remaining order-action admin RPCs for the mock-auth + service-role
-- world. Every mutation that today only patches the in-memory order store now
-- has a server-side counterpart called from /api/orders/[id]/<action>.
--
-- Service-role only. Browser must never invoke these RPCs directly.
-- ============================================================================

-- ── add_order_note_admin ────────────────────────────────────────────────────
create or replace function public.add_order_note_admin(
  p_order_id    uuid,
  p_text        text,
  p_actor_role  public.user_role,
  p_actor_id    uuid    default null,
  p_actor_name  text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;
  if p_text is null or length(trim(p_text)) = 0 then
    raise exception 'note text is required';
  end if;

  insert into public.order_notes (order_id, author_id, author_name, author_role, text)
  values (p_order_id, p_actor_id, p_actor_name, p_actor_role, p_text)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_order_note_admin(uuid, text, public.user_role, uuid, text) from public;
revoke all on function public.add_order_note_admin(uuid, text, public.user_role, uuid, text) from anon;
revoke all on function public.add_order_note_admin(uuid, text, public.user_role, uuid, text) from authenticated;

-- ── apply_coupon_admin ──────────────────────────────────────────────────────
-- Caller (the API route) is responsible for validating the coupon and computing
-- the resulting total. The RPC just persists the snapshot + history row.
create or replace function public.apply_coupon_admin(
  p_order_id        uuid,
  p_coupon_code     text,
  p_coupon_discount numeric,
  p_total           numeric,
  p_actor_role      public.user_role,
  p_actor_id        uuid    default null,
  p_actor_name      text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.order_status;
  v_note   text;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;

  update public.orders
     set coupon_code = nullif(p_coupon_code, ''),
         coupon_discount = coalesce(p_coupon_discount, 0),
         total = coalesce(p_total, total),
         updated_at = now()
   where id = p_order_id
   returning status into v_status;

  v_note := case
    when p_coupon_code is null or p_coupon_code = ''
    then 'coupon:cleared'
    else 'coupon:' || p_coupon_code || ':' || coalesce(p_coupon_discount, 0)::text
  end;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (p_order_id, v_status, p_actor_role, p_actor_id, p_actor_name, v_note);
end;
$$;

revoke all on function public.apply_coupon_admin(uuid, text, numeric, numeric, public.user_role, uuid, text) from public;
revoke all on function public.apply_coupon_admin(uuid, text, numeric, numeric, public.user_role, uuid, text) from anon;
revoke all on function public.apply_coupon_admin(uuid, text, numeric, numeric, public.user_role, uuid, text) from authenticated;

-- ── set_payment_status_admin ────────────────────────────────────────────────
create or replace function public.set_payment_status_admin(
  p_order_id        uuid,
  p_payment_status  public.payment_status,
  p_actor_role      public.user_role,
  p_actor_id        uuid    default null,
  p_actor_name      text    default null,
  p_note            text    default null
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

  update public.orders
     set payment_status = p_payment_status,
         updated_at = now()
   where id = p_order_id
   returning status into v_status;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_status, p_actor_role, p_actor_id, p_actor_name,
    'payment_status:' || p_payment_status::text || coalesce(' — ' || p_note, '')
  );
end;
$$;

revoke all on function public.set_payment_status_admin(uuid, public.payment_status, public.user_role, uuid, text, text) from public;
revoke all on function public.set_payment_status_admin(uuid, public.payment_status, public.user_role, uuid, text, text) from anon;
revoke all on function public.set_payment_status_admin(uuid, public.payment_status, public.user_role, uuid, text, text) from authenticated;

-- ── cancel_order_admin ──────────────────────────────────────────────────────
create or replace function public.cancel_order_admin(
  p_order_id    uuid,
  p_reason      text,
  p_actor_role  public.user_role,
  p_actor_id    uuid    default null,
  p_actor_name  text    default null
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
     set status = 'cancelled',
         updated_at = now()
   where id = p_order_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, 'cancelled', p_actor_role, p_actor_id, p_actor_name,
    'cancel' || coalesce(': ' || nullif(trim(p_reason), ''), '')
  );
end;
$$;

revoke all on function public.cancel_order_admin(uuid, text, public.user_role, uuid, text) from public;
revoke all on function public.cancel_order_admin(uuid, text, public.user_role, uuid, text) from anon;
revoke all on function public.cancel_order_admin(uuid, text, public.user_role, uuid, text) from authenticated;

-- ── reschedule_order_admin ──────────────────────────────────────────────────
create or replace function public.reschedule_order_admin(
  p_order_id          uuid,
  p_visit_date        date,
  p_shift             public.shift_window,
  p_shift_start_time  time    default null,
  p_shift_end_time    time    default null,
  p_actor_role        public.user_role default 'admin',
  p_actor_id          uuid    default null,
  p_actor_name        text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.order_status;
  v_old_date date;
  v_old_shift public.shift_window;
begin
  select visit_date, shift into v_old_date, v_old_shift
    from public.orders where id = p_order_id;
  if v_old_date is null then
    raise exception 'order % does not exist', p_order_id;
  end if;

  update public.orders
     set visit_date = p_visit_date,
         shift = p_shift,
         shift_start_time = p_shift_start_time,
         shift_end_time   = p_shift_end_time,
         updated_at = now()
   where id = p_order_id
   returning status into v_status;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_status, p_actor_role, p_actor_id, p_actor_name,
    'reschedule:' || v_old_date::text || '/' || v_old_shift::text
                 || '->' || p_visit_date::text || '/' || p_shift::text
  );
end;
$$;

revoke all on function public.reschedule_order_admin(uuid, date, public.shift_window, time, time, public.user_role, uuid, text) from public;
revoke all on function public.reschedule_order_admin(uuid, date, public.shift_window, time, time, public.user_role, uuid, text) from anon;
revoke all on function public.reschedule_order_admin(uuid, date, public.shift_window, time, time, public.user_role, uuid, text) from authenticated;

-- ── verify_patient_admin ────────────────────────────────────────────────────
-- Nurse-driven during the visit; admin can also fix it from the OCC.
create or replace function public.verify_patient_admin(
  p_order_id        uuid,
  p_official_name   text,
  p_national_id     text    default null,
  p_note            text    default null,
  p_actor_role      public.user_role default 'nurse',
  p_actor_id        uuid    default null,
  p_actor_name      text    default null
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

  update public.orders
     set patient_official_name = nullif(trim(p_official_name), ''),
         patient_national_id   = nullif(trim(p_national_id), ''),
         internal_notes        = case
           when nullif(trim(p_note), '') is null then internal_notes
           when internal_notes is null then trim(p_note)
           else internal_notes || E'\n' || trim(p_note)
         end,
         updated_at = now()
   where id = p_order_id
   returning status into v_status;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, v_status, p_actor_role, p_actor_id, p_actor_name,
    'verify_patient' || coalesce(': ' || nullif(trim(p_note), ''), '')
  );
end;
$$;

revoke all on function public.verify_patient_admin(uuid, text, text, text, public.user_role, uuid, text) from public;
revoke all on function public.verify_patient_admin(uuid, text, text, text, public.user_role, uuid, text) from anon;
revoke all on function public.verify_patient_admin(uuid, text, text, text, public.user_role, uuid, text) from authenticated;

-- ── force_complete_order_admin ──────────────────────────────────────────────
create or replace function public.force_complete_order_admin(
  p_order_id    uuid,
  p_reason      text,
  p_actor_role  public.user_role default 'admin',
  p_actor_id    uuid    default null,
  p_actor_name  text    default null
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
  if nullif(trim(p_reason), '') is null then
    raise exception 'reason is required';
  end if;

  update public.orders
     set status = 'completed',
         updated_at = now()
   where id = p_order_id;

  insert into public.order_status_history (
    order_id, status, actor_role, actor_id, actor_name, note
  )
  values (
    p_order_id, 'completed', p_actor_role, p_actor_id, p_actor_name,
    'force:' || trim(p_reason)
  );
end;
$$;

revoke all on function public.force_complete_order_admin(uuid, text, public.user_role, uuid, text) from public;
revoke all on function public.force_complete_order_admin(uuid, text, public.user_role, uuid, text) from anon;
revoke all on function public.force_complete_order_admin(uuid, text, public.user_role, uuid, text) from authenticated;
