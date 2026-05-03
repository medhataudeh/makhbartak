import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface AssignLabBody {
  session: AuthSession;
  /** Optional. When omitted, the server runs auto_assign_order to pick one. */
  labId?: string | null;
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

  let body: AssignLabBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, labId, note } = body ?? {};
  if (!session) {
    return NextResponse.json({ error: "session required" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "only admin can assign lab" }, { status: 403 });
  }
  if (labId != null && !isUuid(labId)) {
    return NextResponse.json({ error: "labId must be a uuid" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  if (labId == null) {
    const { error: autoErr } = await sb.rpc("auto_assign_order", { p_order_id: orderId });
    if (autoErr) return NextResponse.json({ error: autoErr.message }, { status: 500 });
  } else {
    const { error: rpcErr } = await sb.rpc("assign_lab_admin", {
      p_order_id: orderId,
      p_lab_id: labId,
      p_actor_role: "admin",
      p_actor_id: null,
      p_actor_name: session.name ?? null,
      p_note: note ?? "manual:lab",
    });
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
