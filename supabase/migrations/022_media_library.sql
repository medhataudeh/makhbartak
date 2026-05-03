-- ============================================================================
-- 022_media_library.sql
-- Media Library: a single `media` storage bucket holds admin-uploaded images
-- (package covers, slider art, lab logos, etc.). `media_assets` records
-- metadata so the admin "مكتبة الوسائط" view can list / search / delete
-- without paginating Storage directly.
--
-- Apply via supabase db push (or paste into the SQL editor). All operations
-- are idempotent so re-running is safe.
-- ============================================================================

-- ── media_assets metadata table ─────────────────────────────────────────────
create table if not exists public.media_assets (
  id            uuid primary key default uuid_generate_v4(),
  -- Storage path inside the `media` bucket. Unique so two rows can't
  -- accidentally point at the same object (admin delete then re-upload
  -- replaces the row by path).
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  width         int,
  height        int,
  alt_text_ar   text,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists media_assets_created_at_idx
  on public.media_assets (created_at desc) where deleted_at is null;

-- updated_at trigger using the project-wide helper
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_media_assets_updated_at'
  ) then
    execute $trigger$
      create trigger trg_media_assets_updated_at
        before update on public.media_assets
        for each row execute function public.tg_set_updated_at()
    $trigger$;
  end if;
end $$;

-- RLS: admin reads/writes via service-role only. The browser never inserts
-- here. Public read is unnecessary because the storage bucket is itself
-- public (URL-only access).
alter table public.media_assets enable row level security;
drop policy if exists media_assets_admin_all on public.media_assets;
create policy media_assets_admin_all
  on public.media_assets
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── Bucket creation (public) ────────────────────────────────────────────────
-- Idempotent insert into storage.buckets. Public read is fine because every
-- saved URL is already in the customer surface — privacy is not the
-- concern here, integrity is (admin-only writes).
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = excluded.public;

-- ── Storage RLS: anyone can read, only admins can write ─────────────────────
-- Drop+recreate so re-runs are safe and any earlier draft policy is replaced.
drop policy if exists "media public read"   on storage.objects;
drop policy if exists "media admin insert"  on storage.objects;
drop policy if exists "media admin update"  on storage.objects;
drop policy if exists "media admin delete"  on storage.objects;

create policy "media public read"
  on storage.objects for select
  to public
  using (bucket_id = 'media');

create policy "media admin insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'media' and public.is_admin());

create policy "media admin update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());

create policy "media admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'media' and public.is_admin());
