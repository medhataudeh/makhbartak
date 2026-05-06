import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";
import { logger } from "@/lib/logger";

interface AssignLabBody {
  labId?: string | null;
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
  let body: AssignLabBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { labId, note } = body ?? {};
  if (labId != null && !isUuid(labId)) {
    return NextResponse.json({ error: "labId must be a uuid" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  // Phase 3.5 controlled auto-assign: null labId triggers DB-only auto pick.
  if (labId == null) {
    const { data: assigned, error: autoErr } = await sb.rpc("auto_assign_order", { p_order_id: orderId });
    if (autoErr) return NextResponse.json({ error: autoErr.message }, { status: 500 });
    const row = Array.isArray(assigned) ? assigned[0] : assigned;
    logger.info("auto-assign lab", { route: "api/orders/assign-lab", orderId, labId: row?.lab_id ?? null });
  } else {
    const { error: rpcErr } = await sb.rpc("assign_lab_admin", {
      p_order_id: orderId,
      p_lab_id: labId,
      p_actor_role: "admin",
      p_actor_id: auth.session.userId,
      p_actor_name: auth.session.fullName ?? null,
      p_note: note ?? "manual:lab",
    });
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
