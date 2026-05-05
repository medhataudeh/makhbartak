import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

interface AssignNurseBody {
  nurseId?: string | null;
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
  let body: AssignNurseBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { nurseId, note } = body ?? {};
  if (nurseId != null && !isUuid(nurseId)) {
    return NextResponse.json({ error: "nurseId must be a uuid" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  // Phase 3.5 controlled auto-assign: a null nurseId triggers
  // `auto_assign_order` again (DB-only selection). Admin can override
  // later with an explicit nurseId.
  if (nurseId == null) {
    const { data: assigned, error: autoErr } = await sb.rpc("auto_assign_order", { p_order_id: orderId });
    if (autoErr) return NextResponse.json({ error: autoErr.message }, { status: 500 });
    const row = Array.isArray(assigned) ? assigned[0] : assigned;
    console.log("[auto-assign:nurse]", { orderId, nurseId: row?.nurse_id ?? null });
  } else {
    const { error: rpcErr } = await sb.rpc("assign_nurse_admin", {
      p_order_id: orderId,
      p_nurse_id: nurseId,
      p_actor_role: "admin",
      p_actor_id: auth.session.userId,
      p_actor_name: auth.session.fullName ?? null,
      p_note: note ?? "manual:nurse",
    });
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
