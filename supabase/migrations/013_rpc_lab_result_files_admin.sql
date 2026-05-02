-- ============================================================================
-- 013_rpc_lab_result_files_admin.sql
-- Phase 3: lab result file admin RPCs (mock-auth + service-role world).
--
-- The existing upload_result_file / archive_result_file RPCs (008) read
-- auth.uid() to populate actor_id. With mock auth there is no Supabase
-- session, so the API routes in src/app/api/orders/[id]/lab/* call these
-- admin variants instead — passing the actor explicitly.
--
-- Service-role only. Browser must never invoke these RPCs directly.
-- When real Supabase Auth lands the route handlers shrink to passthroughs
-- (or are removed) and writes happen via the original RPCs from 008.
-- ============================================================================

-- ── upload_result_file_admin ────────────────────────────────────────────────
-- Atomic insert (and atomic replace when p_replaces_id is set):
--   * if p_replaces_id is non-null, the predecessor is set to status='archived',
--     archived_at=now(), archived_by=p_actor_id, replaced_by_id=<new uuid>
--   * the new row is inserted with status='active' and replaces_id=p_replaces_id
--   * one lab_result_file_events row is appended ('uploaded' or 'replaced')
create or replace function public.upload_result_file_admin(
  p_order_id      uuid,
  p_storage_path  text,
  p_file_name     text,
  p_actor_role    public.user_role,
  p_actor_id      uuid    default null,
  p_actor_name    text    default null,
  p_mime_type     text    default null,
  p_size_bytes    bigint  default null,
  p_replaces_id   uuid    default null,
  p_note          text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lab_id uuid;
  v_id     uuid;
  v_event  public.result_file_event_type;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % does not exist', p_order_id;
  end if;

  select lab_id into v_lab_id from public.orders where id = p_order_id;
  if v_lab_id is null then
    raise exception 'order % has no assigned lab; cannot attach result files', p_order_id;
  end if;

  if p_replaces_id is not null then
    if not exists (select 1 from public.lab_result_files where id = p_replaces_id) then
      raise exception 'predecessor file % does not exist', p_replaces_id;
    end if;
  end if;

  insert into public.lab_result_files (
    order_id, lab_id, storage_path, file_name,
    uploaded_by, uploaded_by_name, note,
    status, replaces_id, mime_type, size_bytes, uploaded_at
  )
  values (
    p_order_id, v_lab_id, p_storage_path, p_file_name,
    p_actor_id, p_actor_name, p_note,
    'active', p_replaces_id,
    coalesce(p_mime_type, 'application/pdf'),
    p_size_bytes,
    now()
  )
  returning id into v_id;

  if p_replaces_id is not null then
    update public.lab_result_files
       set status = 'archived',
           archived_at = now(),
           archived_by = p_actor_id,
           replaced_by_id = v_id
     where id = p_replaces_id
       and status = 'active';
    v_event := 'replaced';
  else
    v_event := 'uploaded';
  end if;

  insert into public.lab_result_file_events (
    order_id, file_id, file_name, event_type, actor_id, actor_name, actor_role, note
  )
  values (
    p_order_id, v_id, p_file_name, v_event, p_actor_id, p_actor_name, p_actor_role, p_note
  );

  return v_id;
end;
$$;

revoke all on function public.upload_result_file_admin(uuid, text, text, public.user_role, uuid, text, text, bigint, uuid, text) from public;
revoke all on function public.upload_result_file_admin(uuid, text, text, public.user_role, uuid, text, text, bigint, uuid, text) from anon;
revoke all on function public.upload_result_file_admin(uuid, text, text, public.user_role, uuid, text, text, bigint, uuid, text) from authenticated;

-- ── archive_result_file_admin ───────────────────────────────────────────────
create or replace function public.archive_result_file_admin(
  p_file_id     uuid,
  p_actor_role  public.user_role,
  p_actor_id    uuid default null,
  p_actor_name  text default null,
  p_note        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_file_name text;
begin
  select order_id, file_name into v_order_id, v_file_name
    from public.lab_result_files
   where id = p_file_id;
  if v_order_id is null then
    raise exception 'file % does not exist', p_file_id;
  end if;

  update public.lab_result_files
     set status = 'archived',
         archived_at = now(),
         archived_by = p_actor_id
   where id = p_file_id;

  insert into public.lab_result_file_events (
    order_id, file_id, file_name, event_type, actor_id, actor_name, actor_role, note
  )
  values (
    v_order_id, p_file_id, v_file_name, 'archived', p_actor_id, p_actor_name, p_actor_role, p_note
  );
end;
$$;

revoke all on function public.archive_result_file_admin(uuid, public.user_role, uuid, text, text) from public;
revoke all on function public.archive_result_file_admin(uuid, public.user_role, uuid, text, text) from anon;
revoke all on function public.archive_result_file_admin(uuid, public.user_role, uuid, text, text) from authenticated;
