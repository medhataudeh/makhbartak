-- ============================================================================
-- 047 — Homepage action sections (customer home "أو ابدأ بطريقتك" cards).
-- ============================================================================
--
-- The two home action cards (ارفع وصفة / اختر تحاليلك بنفسك) were hardcoded in
-- HomeScreen.tsx. This makes them DB-driven content, managed from the admin
-- dashboard like home_sliders (mig 019). Content/presentation only — no
-- business logic. The CTA still routes through the same in-app flows; the
-- table only stores which flow (`action_type`) + optional target
-- (`action_value`).
--
-- RLS is enabled with NO policies → service-role only. Customers read via the
-- public GET /api/home-actions route (service-role, active+safe fields only);
-- admins read/write via /api/admin/home-actions. No anon PostgREST access.
--
-- Enum-safety: action_type is a CHECK-constrained text, not a pg enum, so this
-- single-file migration adds no enum values (no errcode 55P04 risk).
-- ============================================================================

create table if not exists public.homepage_action_sections (
  id             uuid primary key default uuid_generate_v4(),
  title_ar       text not null,
  description_ar text,
  cta_label_ar   text,
  action_type    text not null default 'custom-builder'
                   check (action_type in ('prescription','custom-builder','package','external')),
  action_value   text,                       -- package uuid or external url, by action_type
  icon           text,                       -- lucide icon name (e.g. 'Camera')
  image_url      text,
  accent         text,                       -- visual style key: purple|emerald|cyan|amber
  display_order  int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_homepage_action_sections_order
  on public.homepage_action_sections (display_order);

create trigger trg_homepage_action_sections_updated_at
  before update on public.homepage_action_sections
  for each row execute function public.tg_set_updated_at();

alter table public.homepage_action_sections enable row level security;
-- No policies on purpose: service-role only.


-- ── upsert_home_action_admin ───────────────────────────────────────────────
-- Insert (p_id null → Postgres generates the uuid) or update. Mirrors
-- upsert_slider_admin (mig 019). Returns the row id.
create or replace function public.upsert_home_action_admin(
  p_id            uuid    default null,
  p_title_ar      text    default null,
  p_description_ar text   default null,
  p_cta_label_ar  text    default null,
  p_action_type   text    default 'custom-builder',
  p_action_value  text    default null,
  p_icon          text    default null,
  p_image_url     text    default null,
  p_accent        text    default null,
  p_display_order int     default 0,
  p_is_active     boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_text(p_title_ar, 'title_ar');
  if p_action_type is not null
     and p_action_type not in ('prescription','custom-builder','package','external') then
    raise exception 'نوع الإجراء غير صالح' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.homepage_action_sections (
      title_ar, description_ar, cta_label_ar, action_type, action_value,
      icon, image_url, accent, display_order, is_active
    )
    values (
      trim(p_title_ar), nullif(trim(p_description_ar), ''), nullif(trim(p_cta_label_ar), ''),
      coalesce(p_action_type, 'custom-builder'), nullif(trim(p_action_value), ''),
      nullif(trim(p_icon), ''), nullif(trim(p_image_url), ''), nullif(trim(p_accent), ''),
      coalesce(p_display_order, 0), coalesce(p_is_active, true)
    )
    returning id into v_id;
  else
    update public.homepage_action_sections
       set title_ar       = trim(p_title_ar),
           description_ar  = nullif(trim(p_description_ar), ''),
           cta_label_ar    = nullif(trim(p_cta_label_ar), ''),
           action_type     = coalesce(p_action_type, action_type),
           action_value    = nullif(trim(p_action_value), ''),
           icon            = nullif(trim(p_icon), ''),
           image_url       = nullif(trim(p_image_url), ''),
           accent          = nullif(trim(p_accent), ''),
           display_order   = coalesce(p_display_order, display_order),
           is_active       = coalesce(p_is_active, is_active),
           updated_at      = now()
     where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.upsert_home_action_admin(uuid, text, text, text, text, text, text, text, text, int, boolean) from public, anon, authenticated;

create or replace function public.delete_home_action_admin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.homepage_action_sections where id = p_id;
end;
$$;
revoke all on function public.delete_home_action_admin(uuid) from public, anon, authenticated;


-- ── Seed the two existing cards (idempotent: only when the table is empty) ──
do $$
begin
  if not exists (select 1 from public.homepage_action_sections) then
    insert into public.homepage_action_sections
      (title_ar, description_ar, cta_label_ar, action_type, icon, image_url, accent, display_order, is_active)
    values
      ('ارفع وصفة', 'صوّر وصفة الطبيب وسنحدد التحاليل ونحجز الموعد', 'ارفع الآن',
       'prescription', 'Camera', 'https://picsum.photos/seed/makhbartak-rx/800/520', 'purple', 1, true),
      ('اختر تحاليلك بنفسك', 'ابحث وأضف ما تحتاج فقط — سعر شفّاف لكل تحليل', 'ابدأ الاختيار',
       'custom-builder', 'FlaskConical', 'https://picsum.photos/seed/makhbartak-custom/800/520', 'emerald', 2, true);
  end if;
end $$;
