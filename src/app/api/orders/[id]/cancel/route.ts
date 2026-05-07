import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdminCap } from "@/lib/route-auth";

interface CancelBody { reason?: string }

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAdminCap("operations.cancel");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: CancelBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("cancel_order_admin", {
    p_order_id: orderId,
    p_reason: body?.reason ?? "",
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
    // P5.5 — refuse cancellation while an online payment is still in a
    // money-owed status. The admin must execute the refund first
    // (Stripe Dashboard → webhook, OR /api/admin/payments/[id]/refund).
    // Cash payments are unaffected; reverse_cash_collection_admin still
    // runs on the proceed path. cancel_order_admin intentionally does
    // not call Stripe — provider-side effects stay out of cancel.
    p_refuse_if_unrefunded_online: true,
  });
  // TODO(P5.4): replace raw rpcErr.message echo with safeApiError().
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
