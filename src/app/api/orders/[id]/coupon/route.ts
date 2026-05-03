import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

interface ApplyCouponBody {
  couponCode: string | null;
  couponDiscount: number;
  total: number;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: ApplyCouponBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { couponCode, couponDiscount, total } = body ?? {};
  if (typeof couponDiscount !== "number" || typeof total !== "number") {
    return NextResponse.json({ error: "couponDiscount and total are required numbers" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("apply_coupon_admin", {
    p_order_id: orderId,
    p_coupon_code: couponCode ?? "",
    p_coupon_discount: couponDiscount,
    p_total: total,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
