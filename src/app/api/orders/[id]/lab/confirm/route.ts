import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "lab" && auth.session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }

  const sb = getSupabaseAdmin();
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
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
    p_note: "تأكيد إرسال النتائج",
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
