import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface CancelBody {
  session: AuthSession;
  reason?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  let body: CancelBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, reason } = body ?? {};
  if (!session) return NextResponse.json({ error: "session required" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "only admin can cancel orders" }, { status: 403 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("cancel_order_admin", {
    p_order_id: orderId,
    p_reason: reason ?? "",
    p_actor_role: session.role,
    p_actor_id: null,
    p_actor_name: session.name ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
