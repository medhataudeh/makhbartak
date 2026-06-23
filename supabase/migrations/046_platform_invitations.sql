-- ============================================================================
-- 046 — Platform invitations (staff onboarding via Supabase Auth invite link).
-- ============================================================================
--
-- Adds an app-level invitation record that travels ALONGSIDE Supabase Auth.
-- Supabase still owns the credential + the one-time action link (we mint it
-- with auth.admin.generateLink({type:'invite'}) from the API route). This
-- table holds only the lookup-safe metadata the invite email + the
-- /invite/accept page render:
--   * who invited them, their role
--   * which portal/role they are invited to
--   * lab assignment (for lab users)
--   * intended profile fields (name/phone/city) to stamp on accept
--   * status + expiry
--
-- We deliberately do NOT store the raw invite token. The invitation `id`
-- (an unguessable uuid) is the lookup key passed in the redirect URL and in
-- user_metadata.invitation_id; the Supabase token is what actually grants the
-- session.
--
-- RLS is enabled with NO policies → only the service-role client (which
-- bypasses RLS) reads/writes this table, exclusively through the three RPCs
-- below and the API routes that call them. No anon/auth PostgREST access.
--
-- Enum-safety: this migration adds NO enum values, so the single-file shape
-- is safe (no errcode 55P04 risk).
-- ============================================================================

create table if not exists public.platform_invitations (
  id                  uuid primary key default uuid_generate_v4(),
  email               text not null,
  invited_by_user_id  uuid references public.profiles(id) on delete set null,
  invited_by_name     text,
  invited_by_role     text,
  target_role         text not null
                        check (target_role in ('customer','nurse','lab','admin')),
  target_portal       text,
  lab_id              uuid references public.labs(id) on delete cascade,
  lab_role            text
                        check (lab_role in ('lab_admin','lab_accounting','lab_uploader')),
  nurse_id            uuid,
  admin_role          text
                        check (admin_role in (
                          'super_admin','operations_admin','lab_admin',
                          'customer_support','finance_admin','content_admin')),
  full_name           text,
  phone               text,
  city                text,
  -- Free-form, non-authoritative snapshot of what the inviter chose. The
  -- canonical capability matrix still lives in admin-permissions.ts; this is
  -- only a hint and is never read to grant access.
  permissions         jsonb,
  status              text not null default 'pending'
                        check (status in ('pending','accepted','revoked','expired')),
  expires_at          timestamptz,
  accepted_at         timestamptz,
  accepted_user_id    uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_platform_invitations_email
  on public.platform_invitations (lower(email));
create index if not exists idx_platform_invitations_status
  on public.platform_invitations (status);

alter table public.platform_invitations enable row level security;
-- No policies on purpose: service-role only.


-- ── create_platform_invitation ─────────────────────────────────────────────
-- Records the invitation row. Validation that protects the role/lab invariant
-- lives here so the API route stays thin. Returns the inserted row.
create or replace function public.create_platform_invitation(
  p_email              text,
  p_target_role        text,
  p_invited_by_user_id uuid,
  p_invited_by_name    text    default null,
  p_invited_by_role    text    default null,
  p_full_name          text    default null,
  p_phone              text    default null,
  p_admin_role         text    default null,
  p_lab_id             uuid    default null,
  p_lab_role           text    default null,
  p_nurse_id           uuid    default null,
  p_city               text    default null,
  p_target_portal      text    default null,
  p_permissions        jsonb   default null,
  p_expires_at         timestamptz default null
) returns public.platform_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.platform_invitations;
begin
  if p_email is null or btrim(p_email) = '' then
    raise exception 'البريد الإلكتروني مطلوب' using errcode = 'P0001';
  end if;
  if p_target_role not in ('customer','nurse','lab','admin') then
    raise exception 'الدور المستهدف غير صالح' using errcode = 'P0001';
  end if;

  if p_target_role = 'admin' then
    if p_admin_role is null then
      raise exception 'يجب تحديد دور الإدارة' using errcode = 'P0001';
    end if;
  end if;

  if p_target_role = 'lab' then
    if p_lab_id is null then
      raise exception 'يجب تحديد المختبر' using errcode = 'P0001';
    end if;
    if p_lab_role is null then
      raise exception 'يجب تحديد دور مستخدم المختبر' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.labs where id = p_lab_id and deleted_at is null
    ) then
      raise exception 'المختبر غير موجود' using errcode = 'P0001';
    end if;
  end if;

  insert into public.platform_invitations (
    email, target_role, invited_by_user_id, invited_by_name, invited_by_role,
    full_name, phone, admin_role, lab_id, lab_role, nurse_id, city,
    target_portal, permissions, status, expires_at
  ) values (
    btrim(p_email), p_target_role, p_invited_by_user_id, p_invited_by_name, p_invited_by_role,
    p_full_name, p_phone,
    case when p_target_role = 'admin' then p_admin_role else null end,
    case when p_target_role = 'lab'   then p_lab_id   else null end,
    case when p_target_role = 'lab'   then p_lab_role else null end,
    p_nurse_id, p_city, p_target_portal, p_permissions, 'pending', p_expires_at
  ) returning * into v_row;

  return v_row;
end;
$$;


-- ── get_platform_invitation_public ─────────────────────────────────────────
-- Returns ONLY the display-safe fields for the accept page + email. Never
-- returns finance config, payout rules, settlement data, internal notes, or
-- the raw permissions matrix. `status` is computed: a pending-but-past-expiry
-- invite reads back as 'expired' without mutating the row. Returns NULL when
-- the id does not exist (caller maps to a generic 404 — no existence leak).
create or replace function public.get_platform_invitation_public(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v       public.platform_invitations;
  v_lab   record;
  v_exp   boolean;
  v_stat  text;
  v_out   jsonb;
begin
  select * into v from public.platform_invitations where id = p_id;
  if not found then
    return null;
  end if;

  v_exp  := v.expires_at is not null and v.expires_at < now();
  v_stat := case when v.status = 'pending' and v_exp then 'expired' else v.status end;

  v_out := jsonb_build_object(
    'id',            v.id,
    'email',         v.email,
    'invitedByName', v.invited_by_name,
    'invitedByRole', v.invited_by_role,
    'targetRole',    v.target_role,
    'targetPortal',  v.target_portal,
    'adminRole',     v.admin_role,
    'labRole',       v.lab_role,
    'fullName',      v.full_name,
    'status',        v_stat,
    'expiresAt',     v.expires_at,
    'acceptedAt',    v.accepted_at,
    'isExpired',     v_exp
  );

  if v.target_role = 'lab' and v.lab_id is not null then
    select name_ar, city, area, phone_main, portal_display_name
      into v_lab
      from public.labs
     where id = v.lab_id and deleted_at is null;
    if found then
      v_out := v_out || jsonb_build_object('lab', jsonb_build_object(
        'nameAr',     v_lab.name_ar,
        'city',       v_lab.city,
        'area',       v_lab.area,
        'phone',      v_lab.phone_main,
        'portalName', v_lab.portal_display_name
      ));
    end if;
  end if;

  return v_out;
end;
$$;


-- ── accept_platform_invitation ─────────────────────────────────────────────
-- Idempotent acceptance. Validates the accepting session's email matches the
-- invitation, refuses expired/revoked invites, then performs the role
-- assignment (mirrors POST /api/admin/users): patch profile role, drop the
-- auto-created customers row for non-customer targets, upsert the nurse /
-- lab_user row. Re-accepting by the same user is a no-op success; a different
-- user is refused. Row-locked to serialize concurrent accepts.
create or replace function public.accept_platform_invitation(
  p_id      uuid,
  p_user_id uuid,
  p_email   text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v   public.platform_invitations;
  v_exp boolean;
begin
  select * into v from public.platform_invitations where id = p_id for update;
  if not found then
    raise exception 'الدعوة غير موجودة' using errcode = 'P0001';
  end if;

  if v.status = 'accepted' then
    if v.accepted_user_id is distinct from p_user_id then
      raise exception 'تم قبول هذه الدعوة مسبقاً' using errcode = 'P0001';
    end if;
    return jsonb_build_object('ok', true, 'alreadyAccepted', true, 'targetRole', v.target_role);
  end if;

  if v.status = 'revoked' then
    raise exception 'تم إلغاء هذه الدعوة' using errcode = 'P0001';
  end if;

  v_exp := v.expires_at is not null and v.expires_at < now();
  if v_exp then
    update public.platform_invitations set status = 'expired' where id = p_id;
    raise exception 'انتهت صلاحية هذه الدعوة' using errcode = 'P0001';
  end if;

  if lower(btrim(coalesce(p_email, ''))) is distinct from lower(btrim(v.email)) then
    raise exception 'هذه الدعوة لا تخص هذا الحساب' using errcode = 'P0001';
  end if;

  update public.profiles
     set role       = v.target_role::public.user_role,
         admin_role = case when v.target_role = 'admin' then v.admin_role else null end,
         full_name  = coalesce(v.full_name, full_name),
         phone      = coalesce(v.phone, phone),
         is_active  = true
   where id = p_user_id;

  if v.target_role <> 'customer' then
    delete from public.customers where profile_id = p_user_id;
  end if;

  if v.target_role = 'nurse' then
    insert into public.nurses (profile_id, city, is_active)
    values (p_user_id, coalesce(v.city, 'دمشق'), true)
    on conflict (profile_id)
      do update set is_active = true, city = coalesce(v.city, public.nurses.city), deleted_at = null;
  elsif v.target_role = 'lab' then
    insert into public.lab_users (profile_id, lab_id, role, is_active)
    values (p_user_id, v.lab_id, v.lab_role::public.lab_user_role, true)
    on conflict (profile_id)
      do update set lab_id = excluded.lab_id, role = excluded.role,
                    is_active = true, deleted_at = null;
  end if;

  update public.platform_invitations
     set status = 'accepted', accepted_at = now(), accepted_user_id = p_user_id
   where id = p_id;

  return jsonb_build_object('ok', true, 'targetRole', v.target_role);
end;
$$;
