import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

// Phase 4.1 — atomic cash-collection. Replaces the legacy
// /api/orders/[id]/payment-status nurse path. The RPC enforces ownership +
// state + non-duplicate, writes the canonical paid payment row, flips
// orders.payment_status, credits the nurse wallet, and logs to history. On
// success we return the hydrated order so the nurse UI can re-render.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "nurse") {
    return NextResponse.json({ error: "تأكيد التحصيل متاح للممرضين فقط" }, { status: 403 });
  }
  if (!auth.session.nurseId) {
    return NextResponse.json({ error: "حساب الممرض غير مكتمل. تواصل مع الإدارة." }, { status: 403 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("nurse_collect_cash", {
    p_order_id:   orderId,
    p_nurse_id:   auth.session.nurseId,
    p_actor_id:   auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? "تعذر تأكيد التحصيل";
    // The RPC raises Arabic copy with errcode P0001 for known business
    // errors; surface as 409 so the nurse UI can show it verbatim.
    const isBusiness = typeof msg === "string" && (
      msg.includes("غير مخصص") ||
      msg.includes("تأكيد الوصول") ||
      msg.includes("مسبقاً") ||
      msg.includes("نقدية") ||
      msg.includes("الطلب غير موجود") ||
      msg.includes("قيمة الطلب")
    );
    if (isBusiness) return NextResponse.json({ error: msg }, { status: 409 });
    console.error("[api/orders/cash-collected] rpc failed", { orderId, code: rpcErr.code, message: msg });
    return NextResponse.json({ error: `تعذر تأكيد التحصيل: ${msg}` }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
