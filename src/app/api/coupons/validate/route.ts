import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { validateCouponServer } from "@/lib/server/coupons";
import { safeApiError } from "@/lib/api/safe-error";

// Customer-facing coupon validation. Single source of truth lives in
// `validateCouponServer` (lib/server/coupons.ts) — the same function the
// authoritative order-creation routes use, so preview and submit always
// agree on the math (modulo the cart→submit time window, which remains
// silent-drop by design — see the C1 audit).
//
// Public (no session): every cart, including unauthenticated guests, hits
// this endpoint while applying a code. The route stays public to preserve
// today's contract; rate-limiting is a separate roadmap item (E4) and is
// not introduced here.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
  const total = Number(url.searchParams.get("total") ?? "0");
  if (!code) return NextResponse.json({ valid: false, message: "كود الكوبون مطلوب" }, { status: 400 });
  if (!Number.isFinite(total) || total < 0) {
    return NextResponse.json({ valid: false, message: "إجمالي الطلب غير صالح" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  try {
    const result = await validateCouponServer(sb, code, total);
    if (!result.valid) {
      return NextResponse.json({ valid: false, message: result.messageAr });
    }
    return NextResponse.json({
      valid: true,
      coupon: {
        id: result.coupon.id,
        code: result.coupon.code,
        type: result.coupon.type,
        value: result.coupon.value,
        maxDiscount: result.coupon.maxDiscount,
        minOrderAmount: result.coupon.minOrderAmount,
      },
      discount: result.discount,
      message: result.messageAr,
    });
  } catch (err) {
    const safe = safeApiError(err, {
      route: "api/coupons/validate",
      fallback: "تعذر التحقق من الكوبون",
    });
    return NextResponse.json(safe.body, { status: safe.status });
  }
}
