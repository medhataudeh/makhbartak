-- 051 — Security: close `rls_disabled_in_public`.
--
-- Supabase Security Advisor flagged four public tables (ERROR level,
-- lint 0013_rls_disabled_in_public) that had RLS DISABLED while still
-- carrying the default `anon` / `authenticated` table grants
-- (SELECT/INSERT/UPDATE/DELETE). With RLS off, those grants are live:
-- anyone holding the public anon key could read or mutate these tables
-- directly through PostgREST.
--
-- All four are SERVER-ONLY tables — reached exclusively by API routes /
-- SECURITY DEFINER RPCs through the service-role client, which BYPASSES
-- RLS. The browser never touches them:
--   * nurse_prep_state            — orphaned daily prep store (legacy)
--   * nurse_shortage_requests     — field→admin signal, via
--   * nurse_shortage_request_items   /api/nurses/[id]/shortage-requests
--   * order_idempotency           — order-creation idempotency keys (RPC-internal)
--
-- Fix classification per task: "service-role only". Therefore enable RLS
-- with NO policies — identical to how every other server-only ledger /
-- internal table in this schema is configured (nurse_wallets,
-- payment_provider_events, lab_wallet_transactions, platform_invitations …:
-- RLS ON, zero policies, default grants retained, service-role bypasses).
--
-- No anon/authenticated policies are added: these tables hold operational
-- and finance-adjacent data and must never be client-reachable. Grants are
-- intentionally left as-is to match the rest of the schema; RLS-with-no-policy
-- is what denies anon/authenticated access.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op when already enabled.

alter table public.nurse_prep_state            enable row level security;
alter table public.nurse_shortage_requests     enable row level security;
alter table public.nurse_shortage_request_items enable row level security;
alter table public.order_idempotency           enable row level security;
