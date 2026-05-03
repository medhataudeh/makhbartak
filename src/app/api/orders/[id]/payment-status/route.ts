import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

const ALLOWED = ["pending", "paid", "failed", "refunded"] as const;
type AllowedPaymentStatus = (typeof ALLOWED)[number];

interface SetPaymentStatusBody {
  session: AuthSession;
  paymentStatus: AllowedPaymentStatus;
  note?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  let body: SetPaymentStatusBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, paymentStatus, note } = body ?? {};
  if (!session) return NextResponse.json({ error: "session required" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "only admin can change payment status" }, { status: 403 });
  }
  if (!ALLOWED.includes(paymentStatus as AllowedPaymentStatus)) {
    return NextResponse.json({ error: "invalid payment status" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("set_payment_status_admin", {
    p_order_id: orderId,
    p_payment_status: paymentStatus,
    p_actor_role: session.role,
    p_actor_id: null,
    p_actor_name: session.name ?? null,
    p_note: note ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
