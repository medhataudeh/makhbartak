import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdminCap } from "@/lib/route-auth";
import { logAdminActivity } from "@/lib/admin-activity";

// Phase 4.2 — admin-initiated refund (full or partial). Atomic via
// refund_payment_admin: writes wallet refund debit on the original collector,
// updates payments.refunded_amount + status, and logs an order event.
interface RefundBody {
  amount?: number; // omit for full remaining refund
  reason: string;  // required, Arabic
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: paymentId } = await ctx.params;
  if (!isUuid(paymentId)) {
    return NextResponse.json({ error: "payment id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAdminCap("finance.refund");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: RefundBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const reason = (body?.reason ?? "").trim();
  if (!reason) {
    return NextResponse.json({ error: "سبب الاسترجاع مطلوب" }, { status: 400 });
  }
  const amount = body.amount === undefined || body.amount === null ? null : Number(body.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
    return NextResponse.json({ error: "مبلغ الاسترجاع يجب أن يكون أكبر من صفر" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("refund_payment_admin", {
    p_payment_id: paymentId,
    p_admin_id:   auth.session.userId,
    p_admin_name: auth.session.fullName ?? null,
    p_amount:     amount,
    p_reason:     reason,
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? "تعذر تسجيل الاسترجاع";
    const isBusiness = typeof msg === "string" && (
      msg.includes("الدفعة غير موجودة") ||
      msg.includes("غير مُحصّلة") ||
      msg.includes("مسبقاً") ||
      msg.includes("أكبر من صفر") ||
      msg.includes("المبلغ المتبقي") ||
      msg.includes("سبب الاسترجاع")
    );
    if (isBusiness) return NextResponse.json({ error: msg }, { status: 409 });
    console.error("[api/admin/payments/refund] rpc failed", { paymentId, code: rpcErr.code, message: msg });
    return NextResponse.json({ error: `تعذر تسجيل الاسترجاع: ${msg}` }, { status: 500 });
  }

  await logAdminActivity(
    sb,
    auth.session,
    "invoice_status",
    "payment",
    paymentId,
    `refund:${amount === null ? "full" : amount}:${reason}`,
  );

  return NextResponse.json({ ok: true });
}
