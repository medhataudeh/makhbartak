-- ============================================================================
-- 005_storage_buckets.sql
-- Supabase Storage buckets + storage.objects policies.
-- Run after 004_init_rls_policies.sql.
--
-- Bucket layout:
--   public-assets    PUBLIC.   Marketing images: package/slider/logo, etc.
--   prescriptions    PRIVATE.  One folder per customer: <customer_id>/...
--   lab-results      PRIVATE.  One folder per order:    <order_id>/...
--   nurse-photos     PUBLIC.   Nurse profile photos (low-sensitivity).
--   lab-branding     PUBLIC.   Lab logos / portal headers.
--
-- Path conventions are enforced by the policies below using split_part().
-- ============================================================================

-- Create buckets (id, name, public).
insert into storage.buckets (id, name, public)
values
  ('public-assets',  'public-assets', true),
  ('nurse-photos',   'nurse-photos',  true),
  ('lab-branding',   'lab-branding',  true),
  ('prescriptions',  'prescriptions', false),
  ('lab-results',    'lab-results',   false)
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- public-assets : anyone reads; admin writes.
-- ────────────────────────────────────────────────────────────────────────────
create policy "public-assets read"
  on storage.objects for select
  using (bucket_id = 'public-assets');

create policy "public-assets admin write"
  on storage.objects for all
  using (bucket_id = 'public-assets' and public.is_admin())
  with check (bucket_id = 'public-assets' and public.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- nurse-photos : public read, nurse can write own folder, admin all.
-- Path: <profile_id>/<filename>
-- ────────────────────────────────────────────────────────────────────────────
create policy "nurse-photos read"
  on storage.objects for select
  using (bucket_id = 'nurse-photos');

create policy "nurse-photos owner write"
  on storage.objects for insert
  with check (
    bucket_id = 'nurse-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "nurse-photos owner update"
  on storage.objects for update
  using (
    bucket_id = 'nurse-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "nurse-photos admin all"
  on storage.objects for all
  using (bucket_id = 'nurse-photos' and public.is_admin())
  with check (bucket_id = 'nurse-photos' and public.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- lab-branding : public read, lab admin can write own lab folder, admin all.
-- Path: <lab_id>/<filename>
-- ────────────────────────────────────────────────────────────────────────────
create policy "lab-branding read"
  on storage.objects for select
  using (bucket_id = 'lab-branding');

create policy "lab-branding lab write"
  on storage.objects for all
  using (
    bucket_id = 'lab-branding'
    and public.is_lab_user()
    and split_part(name, '/', 1) = public.current_lab_id()::text
  )
  with check (
    bucket_id = 'lab-branding'
    and public.is_lab_user()
    and split_part(name, '/', 1) = public.current_lab_id()::text
  );

create policy "lab-branding admin all"
  on storage.objects for all
  using (bucket_id = 'lab-branding' and public.is_admin())
  with check (bucket_id = 'lab-branding' and public.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- prescriptions : private. Customer can read/write their own folder. Admin all.
-- Path: <customer_id>/<filename>
-- ────────────────────────────────────────────────────────────────────────────
create policy "prescriptions owner all"
  on storage.objects for all
  using (
    bucket_id = 'prescriptions'
    and split_part(name, '/', 1) = public.current_customer_id()::text
  )
  with check (
    bucket_id = 'prescriptions'
    and split_part(name, '/', 1) = public.current_customer_id()::text
  );

create policy "prescriptions admin all"
  on storage.objects for all
  using (bucket_id = 'prescriptions' and public.is_admin())
  with check (bucket_id = 'prescriptions' and public.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- lab-results : private. Lab can write its own assigned orders; customer reads
-- ACTIVE files for its own orders; admin all.
-- Path: <order_id>/<filename>
-- ────────────────────────────────────────────────────────────────────────────
create policy "lab-results lab write own orders"
  on storage.objects for all
  using (
    bucket_id = 'lab-results'
    and public.is_lab_user()
    and exists (
      select 1 from public.orders o
       where o.id::text = split_part(name, '/', 1)
         and o.lab_id = public.current_lab_id()
    )
  )
  with check (
    bucket_id = 'lab-results'
    and public.is_lab_user()
    and exists (
      select 1 from public.orders o
       where o.id::text = split_part(name, '/', 1)
         and o.lab_id = public.current_lab_id()
    )
  );

-- Customer reads only when there is at least one ACTIVE result file for this
-- order pointing at this storage object. This keeps archived files hidden
-- even from a direct CDN URL.
create policy "lab-results customer read active"
  on storage.objects for select
  using (
    bucket_id = 'lab-results'
    and exists (
      select 1
        from public.lab_result_files f
        join public.orders o on o.id = f.order_id
       where f.storage_path = name
         and f.status = 'active'
         and o.customer_id = public.current_customer_id()
    )
  );

create policy "lab-results admin all"
  on storage.objects for all
  using (bucket_id = 'lab-results' and public.is_admin())
  with check (bucket_id = 'lab-results' and public.is_admin());
