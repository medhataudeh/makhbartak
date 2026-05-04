-- ============================================================================
-- 026_nurse_gamification.sql
-- Production hardening Phase 1:
--   * nurse_gamification — per-nurse counters that previously lived only in
--     MOCK_GAMIFICATION. We persist the row keys + numeric counters; the
--     level tier and badge catalog continue to come from the static
--     NURSE_LEVELS / NURSE_BADGES constants on the client (admin CRUD for
--     levels/badges is deferred to a later phase).
--   * ensure_nurse_gamification_admin RPC: returns the row for a nurse,
--     creating a starter row on first read so admin-created nurses never
--     fall back to mock data.
-- ============================================================================

create table if not exists public.nurse_gamification (
  nurse_id           uuid primary key references public.nurses(id) on delete cascade,
  total_completed    int  not null default 0,
  total_points       int  not null default 0,
  points_today       int  not null default 0,
  monthly_completed  int  not null default 0,
  monthly_points     int  not null default 0,
  failed_count       int  not null default 0,
  -- Stored as 0..100 (percent). Computed/updated server-side later when the
  -- recompute job lands; defaults to 100 for fresh nurses so "success rate"
  -- on the home card doesn't read 0% before the first visit.
  success_rate       int  not null default 100 check (success_rate between 0 and 100),
  streak             int  not null default 0,
  -- Level reference is a stable string id from NURSE_LEVELS on the client
  -- (e.g. "lv-1"). Keeping it as text avoids a separate enum/table just for
  -- Phase 1; promotion to a proper foreign key happens when admin-edit of
  -- levels lands.
  level_id           text not null default 'lv-1',
  updated_at         timestamptz not null default now()
);
create trigger trg_nurse_gamification_updated_at before update on public.nurse_gamification
  for each row execute function public.tg_set_updated_at();

alter table public.nurse_gamification enable row level security;
-- Nurse-self read; admin reads via service-role.
do $$ begin
  create policy nurse_gamification_self_read on public.nurse_gamification
    for select using (
      exists (
        select 1 from public.nurses n
        where n.id = nurse_gamification.nurse_id and n.profile_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

-- Idempotent fetch-or-create: ensures every nurse has exactly one row,
-- returns the row in the response. Service-role only because writes happen
-- alongside the read on first call.
create or replace function public.ensure_nurse_gamification_admin(
  p_nurse_id uuid
)
returns public.nurse_gamification
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.nurse_gamification;
begin
  if p_nurse_id is null then
    raise exception 'nurse_id is required';
  end if;
  if not exists (select 1 from public.nurses where id = p_nurse_id) then
    raise exception 'nurse % not found', p_nurse_id;
  end if;
  insert into public.nurse_gamification (nurse_id)
  values (p_nurse_id)
  on conflict (nurse_id) do nothing;
  select * into v_row from public.nurse_gamification where nurse_id = p_nurse_id;
  return v_row;
end;
$$;
