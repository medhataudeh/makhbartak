import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdminCap } from "@/lib/route-auth";
import { logAdminActivity } from "@/lib/admin-activity";

interface ForceCompleteBody { reason: string; allowUnpaid?: boolean }

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAdminCap("operations.force_complete");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: ForceCompleteBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.reason || !body.reason.trim()) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  // Phase 4.1.1 — RPC refuses unpaid by default. Caller must opt in via
  // allowUnpaid=true; that path stamps [unpaid_force] on the history note
  // and skips commission accrual server-side.
  const { error: rpcErr } = await sb.rpc("force_complete_order_admin", {
    p_order_id: orderId,
    p_reason: body.reason,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
    p_allow_unpaid: !!body.allowUnpaid,
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? "تعذر إغلاق الطلب";
    const isBusiness = typeof msg === "string" && msg.includes("لا يمكن إغلاق طلب غير مدفوع");
    if (isBusiness) return NextResponse.json({ error: msg }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await logAdminActivity(
    sb,
    auth.session,
    "order_update",
    "order",
    orderId,
    `force_complete:${body.reason}${body.allowUnpaid ? " [unpaid]" : ""}`,
  );

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
