-- ============================================================================
-- 044a — Recovery: payment_status + nurse_wallet_txn_type enum values.
-- ============================================================================
--
-- Audit finding (P5.5 staging triage, 2026-05-07):
--   The staging database failed cancel_order_admin with:
--     "invalid input value for enum payment_status: 'paid_by_nurse'"
--
--   Investigation showed mig 033's enum extensions never landed on
--   staging. Original 044 (single-file) reproduced the failure with:
--     "ERROR 55P04: unsafe use of new value 'paid_by_nurse' of enum
--      type payment_status"
--   because the partial unique index in the same file referenced the
--   newly-added values before the runner committed them. The same
--   shape was present in mig 033, which is also why that migration
--   silently dropped its index on transaction-wrapping runners.
--
--   Postgres requires new enum values to be COMMITTED before any
--   query can reference them. The recovery is therefore split into
--   044a (this file: ALTER TYPE only) and 044b (the index, which
--   runs after 044a is committed).
--
-- This file is recovery-only and idempotent. On databases where
-- mig 033 landed cleanly (production, hopefully) every statement is
-- a no-op via IF NOT EXISTS.
--
-- Operational note: future migrations that add an enum value AND
-- index/predicate referencing it must split into separate files for
-- the same 55P04 reason.
--
-- Verification (post-apply):
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
--    WHERE t.typname = 'payment_status' ORDER BY e.enumsortorder;
--   -- expect 7 values: pending, paid, failed, refunded,
--   --                  paid_by_nurse, verified_by_admin, partially_refunded
--
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
--    WHERE t.typname = 'nurse_wallet_txn_type' AND enumlabel = 'refund';
--   -- expect 1 row.

alter type public.payment_status add value if not exists 'paid_by_nurse';
alter type public.payment_status add value if not exists 'verified_by_admin';
alter type public.payment_status add value if not exists 'partially_refunded';

alter type public.nurse_wallet_txn_type add value if not exists 'refund';
