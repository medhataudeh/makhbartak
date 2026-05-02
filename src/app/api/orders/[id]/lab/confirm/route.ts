import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface ConfirmBody {
  session: AuthSession;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }

  let body: ConfirmBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session } = body ?? {};
  if (!session) {
    return NextResponse.json({ error: "session required" }, { status: 401 });
  }
  if (session.role !== "lab" && session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }

  const sb = getSupabaseAdmin();

  // Refuse if no active result files exist — same guard as the mock
  // confirmResultsReady. Surface a friendly Arabic-ready error key so the
  // client can match it without parsing English.
  const { count, error: countErr } = await sb
    .from("lab_result_files")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("status", "active");
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if (!count || count < 1) {
    return NextResponse.json({ error: "no_active_result_files" }, { status: 409 });
  }

  const { error: rpcErr } = await sb.rpc("set_order_status_admin", {
    p_order_id: orderId,
    p_status: "completed",
    p_actor_role: session.role,
    p_actor_id: null,
    p_actor_name: session.name ?? null,
    p_note: "تأكيد إرسال النتائج",
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
