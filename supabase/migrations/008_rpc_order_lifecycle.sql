-- ============================================================================
-- 008_rpc_order_lifecycle.sql
-- RPCs for order lifecycle changes — status, nurse assignment, lab files.
-- ============================================================================

-- ─── set_order_status ───────────────────────────────────────────────────────
-- Updates orders.status and appends an order_status_history row in one call.
-- The actor role is read from the caller's profile.
create or replace function public.set_order_status(
  p_order_id  uuid,
  p_status    public.order_status,
  p_note      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_name text;
begin
  select role, full_name into v_role, v_name
    from public.profiles
   where id = auth.uid();

  update public.orders
     set status = p_status, updated_at = now()
   where id = p_order_id;

  insert into public.order_status_history (order_id, status, actor_role, actor_id, actor_name, note)
  values (p_order_id, p_status, v_role, auth.uid(), v_name, p_note);
end;
$$;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

-- ─── assign_nurse ──────────────────────────────────────────────────────────
create or replace function public.assign_nurse(
  p_order_id  uuid,
  p_nurse_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select full_name into v_name from public.profiles where id = auth.uid();

  update public.orders
     set nurse_id = p_nurse_id, updated_at = now()
   where id = p_order_id;

  insert into public.order_status_history (order_id, status, actor_role, actor_id, actor_name, note)
  select p_order_id, status, 'admin', auth.uid(), v_name, 'nurse assigned'
    from public.orders where id = p_order_id;
end;
$$;
grant execute on function public.assign_nurse(uuid, uuid) to authenticated;

-- ─── upload_result_file / archive_result_file ──────────────────────────────
-- Inserts a row into lab_result_files. Storage upload happens client-side
-- against the `lab-results` bucket BEFORE this RPC is called; the path is
-- recorded here so RLS can join through it.
create or replace function public.upload_result_file(
  p_order_id      uuid,
  p_storage_path  text,
  p_file_name     text,
  p_mime_type     text default null,
  p_size_bytes    bigint default null,
  p_replaces_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lab_id uuid;
  v_id     uuid;
begin
  select lab_id into v_lab_id from public.orders where id = p_order_id;

  -- Atomic replace: archive predecessor, insert successor.
  if p_replaces_id is not null then
    update public.lab_result_files
       set status = 'archived',
           archived_at = now()
     where id = p_replaces_id and status = 'active';
  end if;

  insert into public.lab_result_files (
    order_id, lab_id, storage_path, file_name, mime_type, size_bytes,
    status, uploaded_at
  )
  values (
    p_order_id, v_lab_id, p_storage_path, p_file_name,
    coalesce(p_mime_type, 'application/pdf'),
    p_size_bytes,
    'active', now()
  )
  returning id into v_id;

  insert into public.lab_result_file_events (file_id, order_id, type, actor_id)
  values (v_id, p_order_id, case when p_replaces_id is null then 'uploaded' else 'replaced' end, auth.uid());

  return v_id;
end;
$$;
grant execute on function public.upload_result_file(uuid, text, text, text, bigint, uuid) to authenticated;

create or replace function public.archive_result_file(
  p_file_id  uuid,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  select order_id into v_order_id from public.lab_result_files where id = p_file_id;

  update public.lab_result_files
     set status = 'archived', archived_at = now()
   where id = p_file_id;

  insert into public.lab_result_file_events (file_id, order_id, type, actor_id, note)
  values (p_file_id, v_order_id, 'archived', auth.uid(), p_note);
end;
$$;
grant execute on function public.archive_result_file(uuid, text) to authenticated;
