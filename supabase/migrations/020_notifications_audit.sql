-- ============================================================================
-- 020_notifications_audit.sql
-- Stage G: persist admin activity log + customer/nurse notifications.
--
-- 1. New table admin_activity_logs (frontend was in-memory only).
-- 2. RPCs:
--      * log_activity_admin
--      * insert_notification_admin
--      * mark_notification_read_admin
--
-- The notifications table already exists in 002. recipient_id references
-- profiles.id, so the API route resolves customer.id → profile_id (and
-- nurse.id → profile_id) before calling the RPC.
--
-- Service-role only on every RPC.
-- ============================================================================

-- ── admin_activity_logs ────────────────────────────────────────────────────
create table if not exists public.admin_activity_logs (
  id          uuid primary key default uuid_generate_v4(),
  admin_id    uuid references public.profiles(id) on delete set null,
  admin_name  text,
  role        public.user_role,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     text,
  created_at  timestamptz not null default now()
);

-- ── log_activity_admin ──────────────────────────────────────────────────────
create or replace function public.log_activity_admin(
  p_admin_id    uuid,
  p_admin_name  text,
  p_role        public.user_role,
  p_action      text,
  p_entity      text,
  p_entity_id   text,
  p_details     text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.admin_activity_logs (
    admin_id, admin_name, role, action, entity, entity_id, details
  )
  values (
    p_admin_id, p_admin_name, p_role, p_action, p_entity, p_entity_id, p_details
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.log_activity_admin(uuid, text, public.user_role, text, text, text, text) from public, anon, authenticated;

-- ── insert_notification_admin ───────────────────────────────────────────────
-- recipient is a profiles.id. Caller (the API route) is responsible for the
-- mock-auth → profile_id mapping (customers.profile_id, nurses.profile_id).
create or replace function public.insert_notification_admin(
  p_recipient_id  uuid,
  p_type          public.notification_type,
  p_title_ar      text,
  p_body_ar       text,
  p_order_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_recipient_id) then
    raise exception 'profile % does not exist', p_recipient_id;
  end if;
  insert into public.notifications (recipient_id, type, title_ar, body_ar, order_id)
  values (p_recipient_id, p_type, p_title_ar, p_body_ar, p_order_id)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.insert_notification_admin(uuid, public.notification_type, text, text, uuid) from public, anon, authenticated;

-- ── mark_notification_read_admin ────────────────────────────────────────────
-- Caller is responsible for verifying the notification belongs to the right
-- recipient (the API route enforces this with a recipient_id check).
create or replace function public.mark_notification_read_admin(
  p_id            uuid,
  p_recipient_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
     set is_read = true
   where id = p_id and recipient_id = p_recipient_id;
end;
$$;

revoke all on function public.mark_notification_read_admin(uuid, uuid) from public, anon, authenticated;
