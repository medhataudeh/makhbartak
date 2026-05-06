import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

// Phase 4.1.1 — admin office-collection. The atomic body lives in
// admin_record_cash_payment (mig 032). On the order's nurse the wallet
// receives the same `cash_collected` credit it would have received had the
// nurse collected. With no nurse the payments row is still written so the
// audit invariant "every paid order owns a paid payments row" holds.
interface Body { note?: string }

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* empty */ }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("admin_record_cash_payment", {
    p_order_id:   orderId,
    p_admin_id:   auth.session.userId,
    p_admin_name: auth.session.fullName ?? null,
    p_note:       body.note ?? null,
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? "تعذر تسجيل التحصيل";
    const isBusiness = typeof msg === "string" && (
      msg.includes("الطلب غير موجود") ||
      msg.includes("النقدية") ||
      msg.includes("مسبقاً") ||
      msg.includes("قيمة الطلب")
    );
    if (isBusiness) return NextResponse.json({ error: msg }, { status: 409 });
    console.error("[api/admin/orders/record-cash-payment] rpc failed", { orderId, code: rpcErr.code, message: msg });
    return NextResponse.json({ error: `تعذر تسجيل التحصيل: ${msg}` }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
