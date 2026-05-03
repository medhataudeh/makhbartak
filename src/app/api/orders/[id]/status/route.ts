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
  if (rowErr) {
    console.error("[api/orders/status] order lookup failed", { id, code: rowErr.code, message: rowErr.message });
    return NextResponse.json({ error: "تعذر قراءة الطلب من قاعدة البيانات" }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });

  // Nurse can only update orders they're assigned to. The session.nurseId
  // is the real nurses.id (route-auth fetches it via service-role from
  // nurses.profile_id = auth.uid()). We never compare against profile_id /
  // auth user id here.
  if (auth.session.role === "nurse") {
    if (!auth.session.nurseId) {
      console.error("[api/orders/status] nurse session missing nurseId", { userId: auth.session.userId });
      return NextResponse.json({ error: "حساب الممرض غير مكتمل. تواصل مع الإدارة." }, { status: 403 });
    }
    if (row.nurse_id !== auth.session.nurseId) {
      console.warn("[api/orders/status] nurse tried to update unassigned order", {
        orderId: id, expected: row.nurse_id, sessionNurseId: auth.session.nurseId,
      });
      return NextResponse.json({ error: "هذا الطلب غير مخصص لك" }, { status: 403 });
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
    console.error("[api/orders/status] set_order_status_admin failed", {
      orderId: id, status, sqlStatus, code: rpcErr.code, message: rpcErr.message, details: rpcErr.details,
    });
    return NextResponse.json({ error: `تعذر تحديث حالة الطلب: ${rpcErr.message}` }, { status: 500 });
  }

  const order = await fetchOrderById(sb, id);
  return NextResponse.json({ order });
}
