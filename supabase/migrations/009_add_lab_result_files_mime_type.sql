-- ============================================================================
-- 009_add_lab_result_files_mime_type.sql
-- Adds the file-metadata columns referenced by the orders fetch query and
-- the upload_result_file RPC (007/008) but missing from the original 002 DDL.
--
-- Triggered by the runtime error:
--   42703: column lab_result_files_1.mime_type does not exist
--
-- The frontend orders SELECT joins:
--   result_files:lab_result_files (
--     id, storage_path, file_name, mime_type, size_bytes,
--     status, uploaded_at, archived_at
--   )
-- The schema previously only had `created_at`; we add the three missing
-- columns and backfill `uploaded_at` from `created_at` so existing rows have
-- a sensible value.
-- ============================================================================

alter table public.lab_result_files
  add column if not exists mime_type   text,
  add column if not exists size_bytes  bigint,
  add column if not exists uploaded_at timestamptz;

-- Backfill uploaded_at from created_at on existing rows (idempotent).
update public.lab_result_files
   set uploaded_at = created_at
 where uploaded_at is null;

-- New rows default to now() if the RPC didn't pass an explicit value.
alter table public.lab_result_files
  alter column uploaded_at set default now();
