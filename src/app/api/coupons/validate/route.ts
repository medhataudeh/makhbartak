import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";

// Customer-facing coupon validation. The server checks the coupons table
// (active flag, date window, usage limit, min-order amount), computes the
// discount with the cap, and returns a snapshot the cart writes onto the
// order at confirm time. No session required.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
  const total = Number(url.searchParams.get("total") ?? "0");
  if (!code) return NextResponse.json({ valid: false, message: "كود الكوبون مطلوب" }, { status: 400 });
  if (!Number.isFinite(total) || total < 0) {
    return NextResponse.json({ valid: false, message: "إجمالي الطلب غير صالح" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: c, error } = await sb
    .from("coupons")
    .select("id, code, type, value, min_order_amount, max_discount, usage_limit, used_count, start_date, expiry_date, is_active")
    .eq("code", code)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!c || !c.is_active) {
    return NextResponse.json({ valid: false, message: "الكوبون غير صالح" });
  }

  const today = new Date().toISOString().split("T")[0];
  if (today < c.start_date || today > c.expiry_date) {
    return NextResponse.json({ valid: false, message: "انتهت صلاحية الكوبون" });
  }
  if (c.usage_limit > 0 && c.used_count >= c.usage_limit) {
    return NextResponse.json({ valid: false, message: "الكوبون غير صالح" });
  }
  if (total < Number(c.min_order_amount)) {
    return NextResponse.json({ valid: false, message: "الطلب لا يحقق الحد الأدنى لاستخدام الكوبون" });
  }

  const raw = c.type === "percentage"
    ? (total * Number(c.value)) / 100
    : Number(c.value);
  const cap = Number(c.max_discount);
  const discount = cap > 0 ? Math.min(raw, cap) : raw;
  return NextResponse.json({
    valid: true,
    coupon: {
      id: c.id, code: c.code, type: c.type, value: Number(c.value),
      maxDiscount: cap, minOrderAmount: Number(c.min_order_amount),
    },
    discount: Math.round(discount * 100) / 100,
    message: "تم تطبيق الخصم",
  });
}
