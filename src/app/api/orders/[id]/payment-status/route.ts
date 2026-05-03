import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

const ALLOWED = ["pending", "paid", "failed", "refunded"] as const;
type AllowedPaymentStatus = (typeof ALLOWED)[number];

interface SetPaymentStatusBody {
  paymentStatus: AllowedPaymentStatus;
  note?: string;
}

// POST /api/orders/[id]/payment-status
// Admin can set any payment status. Nurse can ONLY mark a cash order as
// `paid` (collection confirmation). Any other transition from a nurse
// session is rejected. Always re-checks that the order is assigned to the
// nurse — the FK comparison uses `nurses.id` (= auth.session.nurseId), not
// `profile_id` / auth user id.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "admin" && auth.session.role !== "nurse") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  let body: SetPaymentStatusBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { paymentStatus, note } = body ?? {};
  if (!ALLOWED.includes(paymentStatus as AllowedPaymentStatus)) {
    return NextResponse.json({ error: "حالة الدفع غير صالحة" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Nurse-specific gating — verify ownership + restrict to cash-collection.
  if (auth.session.role === "nurse") {
    const { data: row, error: rowErr } = await sb
      .from("orders").select("id, nurse_id, payment_method").eq("id", orderId).maybeSingle();
    if (rowErr) {
      console.error("[api/orders/payment-status] order lookup failed", { orderId, code: rowErr.code, message: rowErr.message });
      return NextResponse.json({ error: "تعذر قراءة الطلب من قاعدة البيانات" }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    if (!auth.session.nurseId || row.nurse_id !== auth.session.nurseId) {
      console.warn("[api/orders/payment-status] nurse tried to update unassigned order", {
        orderId, expected: row.nurse_id, sessionNurseId: auth.session.nurseId,
      });
      return NextResponse.json({ error: "هذا الطلب غير مخصص لك" }, { status: 403 });
    }
    if (row.payment_method !== "cash") {
      return NextResponse.json({ error: "تأكيد التحصيل متاح للطلبات النقدية فقط" }, { status: 400 });
    }
    if (paymentStatus !== "paid") {
      return NextResponse.json({ error: "الممرض يستطيع تأكيد تحصيل الدفع فقط" }, { status: 403 });
    }
  }

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
