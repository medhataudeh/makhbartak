import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Coupon Single Source of Truth — server-only.
//
// One function owns the date / usage / min / type / cap / rounding semantics
// for every coupon validation in the platform. Today three near-identical
// blocks live in:
//   * src/app/api/coupons/validate/route.ts        (preview, public)
//   * src/app/api/orders/route.ts                  (customer order create)
//   * src/app/api/admin/orders/route.ts            (admin order create)
//
// C1 is a pure addition: this module is introduced without any caller swaps,
// so no behaviour changes anywhere. C2-C4 will swap the three callsites onto
// this function in subsequent PRs.
//
// Behaviour preserved exactly (verified against the three current blocks):
//   • Code lookup is case-insensitive: input is trimmed and uppercased here
//     before the SELECT.
//   • Date window check uses inclusive bounds: today >= start_date && today <= expiry_date.
//   • Usage cap matches today's three blocks:
//       usage_limit > 0 && used_count >= usage_limit  →  invalid.
//     IMPORTANT: `used_count` is never incremented anywhere in the codebase
//     (no UPDATE in any RPC or route — verified as part of the C1 audit), so
//     this check is effectively a no-op today. Phase E3 may fix it later via
//     a transactional RPC; for now we preserve the broken-but-stable
//     semantics intentionally per the audit decision.
//   • Min-order check uses subtotal >= min_order_amount, with defensive
//     numeric coercion (Number(x ?? 0)).
//   • Discount math:
//       raw = type === 'percentage' ? subtotal * value / 100 : value
//       capped = max_discount > 0 ? Math.min(raw, max_discount) : raw
//       rounded = Math.round(capped * 100) / 100
//   • Arabic message strings match the existing public route exactly:
//       "الكوبون غير صالح"
//       "انتهت صلاحية الكوبون"
//       "الطلب لا يحقق الحد الأدنى لاستخدام الكوبون"
//       "تم تطبيق الخصم"
//
// Database errors propagate (the function throws). Callers decide whether to
// log + return 500 (preview route) or wrap in try/catch and silently drop
// (order-create routes). Centralising error policy in the module would
// flatten today's intentional-by-context behaviour split documented in the
// C1 audit, so it stays at the callsite.
// ─────────────────────────────────────────────────────────────────────────────

export type CouponInvalidReason =
  /** Code did not match any row in coupons. */
  | "unknown"
  /** Found but is_active = false. */
  | "inactive"
  /** Outside [start_date, expiry_date]. */
  | "expired"
  /** usage_limit > 0 && used_count >= usage_limit (preserves today's broken
   *  enforcement — used_count is never incremented in the codebase). */
  | "usage_capped"
  /** Subtotal does not meet min_order_amount. */
  | "min_not_met"
  /** Empty / blank input. */
  | "empty_code";

export interface CouponSnapshot {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  maxDiscount: number;
  minOrderAmount: number;
}

export type CouponValidationResult =
  | {
      valid: true;
      /** Canonical (uppercase) code as stored. */
      code: string;
      /** Discount in SYP, rounded to two decimals. Always > 0 when valid. */
      discount: number;
      coupon: CouponSnapshot;
      messageAr: string; // "تم تطبيق الخصم"
    }
  | {
      valid: false;
      reason: CouponInvalidReason;
      messageAr: string;
    };

const MSG_INVALID    = "الكوبون غير صالح";
const MSG_EXPIRED    = "انتهت صلاحية الكوبون";
const MSG_MIN_NOT_MET = "الطلب لا يحقق الحد الأدنى لاستخدام الكوبون";
const MSG_APPLIED    = "تم تطبيق الخصم";

interface CouponRow {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number | string;
  min_order_amount: number | string | null;
  max_discount: number | string | null;
  usage_limit: number | null;
  used_count: number | null;
  start_date: string;
  expiry_date: string;
  is_active: boolean;
}

/**
 * Validate a coupon code against a subtotal and compute the resulting
 * discount. Returns a discriminated result so callers can render the
 * outcome explicitly (preview route) or silently drop on invalid
 * (order-create routes).
 *
 * Throws on database read errors — callers decide policy.
 *
 * @param sb        service-role Supabase client (RLS bypass; coupons table
 *                  has no public-write policy, so service-role is the
 *                  expected caller).
 * @param rawCode   user-supplied code; trimmed + uppercased internally.
 * @param subtotal  authoritative subtotal in SYP. Min-order check + discount
 *                  math both use this value as-is (no further conversion).
 */
export async function validateCouponServer(
  sb: SupabaseClient,
  rawCode: string | null | undefined,
  subtotal: number,
): Promise<CouponValidationResult> {
  const code = (rawCode ?? "").trim().toUpperCase();
  if (!code) {
    return { valid: false, reason: "empty_code", messageAr: MSG_INVALID };
  }

  const { data, error } = await sb
    .from("coupons")
    .select(
      "id, code, type, value, min_order_amount, max_discount, usage_limit, used_count, start_date, expiry_date, is_active",
    )
    .eq("code", code)
    .maybeSingle();

  if (error) {
    // Bubble the error so the caller can choose its policy. The preview
    // route turns this into a 500 (with safeApiError in C2); the order-
    // create routes wrap in try/catch and silently drop, matching today.
    throw error;
  }

  const row = data as CouponRow | null;
  if (!row) {
    return { valid: false, reason: "unknown", messageAr: MSG_INVALID };
  }
  if (!row.is_active) {
    return { valid: false, reason: "inactive", messageAr: MSG_INVALID };
  }

  const today = new Date().toISOString().split("T")[0];
  if (today < row.start_date || today > row.expiry_date) {
    return { valid: false, reason: "expired", messageAr: MSG_EXPIRED };
  }

  // Preserves today's (broken) enforcement: usage_limit > 0 with
  // used_count >= usage_limit blocks. used_count is never incremented in
  // the codebase, so this branch is effectively unreachable today.
  // Intentional per the C1 audit decision.
  const usageLimit = row.usage_limit ?? 0;
  const usedCount = row.used_count ?? 0;
  if (usageLimit > 0 && usedCount >= usageLimit) {
    return { valid: false, reason: "usage_capped", messageAr: MSG_INVALID };
  }

  const minOrderAmount = Number(row.min_order_amount ?? 0);
  if (subtotal < minOrderAmount) {
    return { valid: false, reason: "min_not_met", messageAr: MSG_MIN_NOT_MET };
  }

  const value = Number(row.value ?? 0);
  const cap = Number(row.max_discount ?? 0);
  const raw =
    row.type === "percentage" ? (subtotal * value) / 100 : value;
  const capped = cap > 0 ? Math.min(raw, cap) : raw;
  const discount = Math.round(capped * 100) / 100;

  return {
    valid: true,
    code: row.code,
    discount,
    coupon: {
      id: row.id,
      code: row.code,
      type: row.type,
      value,
      maxDiscount: cap,
      minOrderAmount,
    },
    messageAr: MSG_APPLIED,
  };
}
