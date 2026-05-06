import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

// Phase 4.1.1 — `paid` is no longer accepted here. The canonical paths are:
//   * Nurse  → POST /api/orders/[id]/cash-collected (RPC nurse_collect_cash)
//   * Admin  → POST /api/admin/orders/[id]/record-cash-payment (RPC admin_record_cash_payment)
// Both RPCs write the payments row, flip orders.payment_status, credit the
// nurse wallet, and log history in one transaction. Allowing `paid` here
// would re-open the off-ledger flip-the-status hole flagged by the audit.
const ALLOWED = ["pending", "failed", "refunded"] as const;
type AllowedPaymentStatus = (typeof ALLOWED)[number];

interface SetPaymentStatusBody {
  paymentStatus: AllowedPaymentStatus | "paid";
  note?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "admin") {
    // Nurse calls the dedicated cash-collected endpoint. Anything else has no
    // business mutating payment_status, so this is admin-only post-4.1.1.
    return NextResponse.json({
      error: "هذه العملية متاحة للإدارة فقط. الممرض يستخدم تأكيد التحصيل النقدي.",
    }, { status: 403 });
  }
  let body: SetPaymentStatusBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { paymentStatus, note } = body ?? {};
  if (paymentStatus === "paid") {
    return NextResponse.json({
      error: "لا يمكن وضع الطلب كمدفوع من هنا. استخدم تسجيل التحصيل النقدي أو مسار الدفع الإلكتروني.",
    }, { status: 409 });
  }
  if (!ALLOWED.includes(paymentStatus as AllowedPaymentStatus)) {
    return NextResponse.json({ error: "حالة الدفع غير صالحة" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  const { error: rpcErr } = await sb.rpc("set_payment_status_admin", {
    p_order_id: orderId,
    p_payment_status: paymentStatus,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
    p_note: note ?? null,
  });
  if (rpcErr) {
    console.error("[api/orders/payment-status] set_payment_status_admin failed", {
      orderId, paymentStatus, code: rpcErr.code, message: rpcErr.message, details: rpcErr.details,
    });
    return NextResponse.json({ error: `تعذر تحديث حالة الدفع: ${rpcErr.message}` }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
