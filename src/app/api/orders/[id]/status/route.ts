import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { fetchOrderById } from "@/lib/supabase/queries/orders";
import { tsStatusToSql } from "@/lib/supabase/order-status";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession, OrderStatus } from "@/lib/types";

interface SetStatusBody {
  session: AuthSession;
  status: OrderStatus;
  note?: string;
  reason?: string;
}

// SQL public.user_role enum (001_init_enums.sql:11-16). Map our mock session
// role onto this enum so order_status_history.actor_role stays valid.
type SqlActorRole = "customer" | "admin" | "lab" | "nurse";
function actorRoleForSession(session: AuthSession): SqlActorRole | null {
  switch (session.role) {
    case "nurse": return "nurse";
    case "admin": return "admin";
    case "lab":   return "lab";
    case "customer": return "customer";
    default: return null;
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }

  let body: SetStatusBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, status, note, reason } = body ?? {};
  if (!session) {
    return NextResponse.json({ error: "session required" }, { status: 401 });
  }
  // Phase 2 only allows nurse + admin to write order status. Customer and
  // lab paths are out of scope this phase.
  if (session.role !== "nurse" && session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized to update status" }, { status: 403 });
  }
  if (!status) {
    return NextResponse.json({ error: "status required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Verify the order exists (deterministic 404 vs cryptic RPC error).
  const { data: row, error: rowErr } = await sb
    .from("orders")
    .select("id, nurse_id")
    .eq("id", id)
    .maybeSingle();
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "order not found" }, { status: 404 });

  // Nurse ownership guard — only enforced when the session carries a real
  // nurse UUID. Mock nurse seeds today use slug ids ("nur-1"), so this gate
  // is permissive in mock-auth mode by design. When a nurse-uuid seed lands
  // in a later migration, this branch starts enforcing automatically.
  if (session.role === "nurse" && isUuid(session.linkedEntityId)) {
    if (row.nurse_id !== session.linkedEntityId) {
      return NextResponse.json({ error: "this order is not assigned to you" }, { status: 403 });
    }
  }

  const sqlStatus = tsStatusToSql(status);
  const actorRole = actorRoleForSession(session);
  if (!actorRole) {
    return NextResponse.json({ error: "unsupported actor role" }, { status: 400 });
  }

  // Combine the optional reason and note into a single history note column
  // — matches the existing setOrderStatus(reason) pattern (the "failed:" /
  // "lab_issue" prefixes are preserved when the caller passes them).
  const combinedNote =
    reason && note ? `${reason} — ${note}` :
    reason ? reason :
    note ? note :
    null;

  const { error: rpcErr } = await sb.rpc("set_order_status_admin", {
    p_order_id: id,
    p_status: sqlStatus,
    p_actor_role: actorRole,
    p_actor_id: null,                 // no real auth.users id under mock auth
    p_actor_name: session.name ?? null,
    p_note: combinedNote,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  // Hydrate the row so the client gets a full TS Order back (status already
  // mapped via sqlStatusToTs by fetchOrderById).
  const order = await fetchOrderById(sb, id);
  return NextResponse.json({ order });
}
