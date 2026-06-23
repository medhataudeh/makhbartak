-- ============================================================================
-- 049 — Nurse daily prep confirmation (server-side gate for "starting the day").
-- ============================================================================
--
-- Before a nurse goes online ("بدأت يومي"), they must explicitly confirm they
-- prepared the required tools. That confirmation must be auditable and
-- server-enforced — not a frontend-only checkbox.
--
-- `nurse_prep_state` (mig 016) tracks which checklist rows are *ticked* during
-- the day; it is mutated on every toggle and its `started` flag is no longer
-- the day-start gate. This table is the distinct, append-style *confirmation
-- event*: one row per (nurse, work_date) recording WHEN the nurse confirmed
-- readiness and WHICH tool ids they confirmed. The /api/nurses/[id]/online
-- route refuses to flip is_online=true for a nurse session unless a row exists
-- here for the current (Asia/Damascus) date.
--
-- RLS enabled with NO policies → service-role only, reached exclusively through
-- the API routes that call the RPC below. No anon/auth PostgREST access.
--
-- Enum-safety: adds no enum values (single-file shape is safe).
-- ============================================================================

create table if not exists public.nurse_daily_prep_confirmations (
  id              uuid primary key default uuid_generate_v4(),
  nurse_id        uuid not null references public.nurses(id) on delete cascade,
  work_date       date not null,
  confirmed_at    timestamptz not null default now(),
  confirmed_items jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  unique (nurse_id, work_date)
);

create index if not exists idx_nurse_daily_prep_conf_nurse_date
  on public.nurse_daily_prep_confirmations (nurse_id, work_date);

alter table public.nurse_daily_prep_confirmations enable row level security;
-- No policies on purpose: service-role only.


-- ── confirm_nurse_daily_prep ────────────────────────────────────────────────
-- Idempotent upsert. Re-confirming the same day refreshes confirmed_at +
-- confirmed_items (created_at is preserved). Returns the row.
create or replace function public.confirm_nurse_daily_prep(
  p_nurse_id        uuid,
  p_work_date       date,
  p_confirmed_items jsonb default '[]'::jsonb
) returns public.nurse_daily_prep_confirmations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.nurse_daily_prep_confirmations;
begin
  if p_nurse_id is null then
    raise exception 'معرّف الممرض مطلوب' using errcode = 'P0001';
  end if;
  if p_work_date is null then
    raise exception 'تاريخ العمل مطلوب' using errcode = 'P0001';
  end if;

  insert into public.nurse_daily_prep_confirmations (nurse_id, work_date, confirmed_items)
  values (p_nurse_id, p_work_date, coalesce(p_confirmed_items, '[]'::jsonb))
  on conflict (nurse_id, work_date)
    do update set confirmed_at    = now(),
                  confirmed_items = coalesce(excluded.confirmed_items, '[]'::jsonb)
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.confirm_nurse_daily_prep(uuid, date, jsonb) from public, anon, authenticated;
