-- ============================================================================
-- 024_nurse_online_status.sql
-- Per-nurse "I am working today" flag, persisted in DB so the prep
-- checklist only appears when the nurse goes from offline → online (i.e.
-- starts a work shift), not on every login. The nurse app reads/writes
-- this flag through /api/nurses/[id]/online.
-- Idempotent.
-- ============================================================================

alter table public.nurses
  add column if not exists is_online boolean not null default false;

-- Optional bookkeeping for the moment the shift began. Cleared on go-offline.
alter table public.nurses
  add column if not exists online_since timestamptz;
