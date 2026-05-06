import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdminCap } from "@/lib/route-auth";

// Phase 4.2 — admin verification of a nurse-collected payment.
// payments.status: paid_by_nurse → verified_by_admin.
// Refuses double-verify and refuses verifying anything not yet collected.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: paymentId } = await ctx.params;
  if (!isUuid(paymentId)) {
    return NextResponse.json({ error: "payment id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAdminCap("finance.verify");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("verify_payment_admin", {
    p_payment_id: paymentId,
    p_admin_id:   auth.session.userId,
    p_admin_name: auth.session.fullName ?? null,
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? "تعذر التحقق من الدفعة";
    const isBusiness = typeof msg === "string" && (
      msg.includes("الدفعة غير موجودة") ||
      msg.includes("مسبقاً") ||
      msg.includes("غير مُحصّلة")
    );
    if (isBusiness) return NextResponse.json({ error: msg }, { status: 409 });
    console.error("[api/admin/payments/verify] rpc failed", { paymentId, code: rpcErr.code, message: msg });
    return NextResponse.json({ error: `تعذر التحقق: ${msg}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
