import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { fetchOrderById } from "@/lib/supabase/queries/orders";
import { tsStatusToSql } from "@/lib/supabase/order-status";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import type { OrderStatus } from "@/lib/types";

interface SetStatusBody {
  status: OrderStatus;
  note?: string;
  reason?: string;
}

type SqlActorRole = "customer" | "admin" | "lab" | "nurse";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "nurse" && auth.session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized to update status" }, { status: 403 });
  }

  let body: SetStatusBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { status, note, reason } = body ?? {};
  if (!status) {
    return NextResponse.json({ error: "status required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  const { data: row, error: rowErr } = await sb
    .from("orders").select("id, nurse_id").eq("id", id).maybeSingle();
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "order not found" }, { status: 404 });

  // Nurse can only update orders they're assigned to.
  if (auth.session.role === "nurse") {
    if (!auth.session.nurseId || row.nurse_id !== auth.session.nurseId) {
      return NextResponse.json({ error: "this order is not assigned to you" }, { status: 403 });
    }
  }

  const sqlStatus = tsStatusToSql(status);
  const actorRole: SqlActorRole = auth.session.role;
  const combinedNote =
    reason && note ? `${reason} — ${note}` :
    reason ? reason :
    note ? note :
    null;

  const { error: rpcErr } = await sb.rpc("set_order_status_admin", {
    p_order_id: id,
    p_status: sqlStatus,
    p_actor_role: actorRole,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
    p_note: combinedNote,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const order = await fetchOrderById(sb, id);
  return NextResponse.json({ order });
}
