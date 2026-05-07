-- ============================================================================
-- 044b — Recovery: payments_one_paid_per_order partial unique index.
-- ============================================================================
--
-- This file MUST run after 044a is committed. The new payment_status
-- enum values added in 044a (paid_by_nurse, verified_by_admin,
-- partially_refunded) are referenced in the WHERE clause below; if
-- they are not yet committed, Postgres raises 55P04 "unsafe use of
-- new value of enum type". This is the same constraint that prevented
-- mig 033 from creating this index on transaction-wrapping runners
-- and is why 044a/044b are split.
--
-- Idempotent via IF NOT EXISTS. On databases where mig 033 landed
-- cleanly the index already exists and this is a no-op.
--
-- Without this index a single order can hold multiple paid-ish
-- payment rows. Finance reconciliation diverges from canonical truth.
-- The four statuses below are the "money owed to the customer" set:
-- a paid-ish row in any of these states locks out a second paid row
-- for the same order. The partial-index predicate is identical to
-- mig 033 line 44.
--
-- Verification (post-apply):
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'payments'
--      AND indexname = 'payments_one_paid_per_order';
--   -- expect 1 row showing the WHERE clause with all four statuses.
--
--   -- Re-run the failing P5.5 cancel scenario on an online-paid
--   -- order. Expect P0001 'يجب تنفيذ الاسترداد أولاً قبل إلغاء الطلب'
--   -- — i.e. the guard fires correctly, NOT the prior enum-cast
--   -- error.

create unique index if not exists payments_one_paid_per_order
  on public.payments(order_id)
  where status in ('paid', 'paid_by_nurse', 'verified_by_admin', 'partially_refunded');
