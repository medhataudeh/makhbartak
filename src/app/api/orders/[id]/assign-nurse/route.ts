import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface AssignNurseBody {
  session: AuthSession;
  /** Optional. When omitted, the server runs auto_assign_order to pick one. */
  nurseId?: string | null;
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

  let body: AssignNurseBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, nurseId, note } = body ?? {};
  if (!session) {
    return NextResponse.json({ error: "session required" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "only admin can assign nurse" }, { status: 403 });
  }
  if (nurseId != null && !isUuid(nurseId)) {
    return NextResponse.json({ error: "nurseId must be a uuid" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  if (nurseId == null) {
    // Auto path — let the server pick. auto_assign_order is a no-op for the
    // lab side when one is already set; we still let it run because the
    // admin may also want to fill in a missing lab in the same call.
    const { error: autoErr } = await sb.rpc("auto_assign_order", { p_order_id: orderId });
    if (autoErr) return NextResponse.json({ error: autoErr.message }, { status: 500 });
  } else {
    const { error: rpcErr } = await sb.rpc("assign_nurse_admin", {
      p_order_id: orderId,
      p_nurse_id: nurseId,
      p_actor_role: "admin",
      p_actor_id: null,
      p_actor_name: session.name ?? null,
      p_note: note ?? "manual:nurse",
    });
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
