import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

const ALLOWED = ["pending", "paid", "failed", "refunded"] as const;
type AllowedPaymentStatus = (typeof ALLOWED)[number];

interface SetPaymentStatusBody {
  paymentStatus: AllowedPaymentStatus;
  note?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: SetPaymentStatusBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { paymentStatus, note } = body ?? {};
  if (!ALLOWED.includes(paymentStatus as AllowedPaymentStatus)) {
    return NextResponse.json({ error: "invalid payment status" }, { status: 400 });
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
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
