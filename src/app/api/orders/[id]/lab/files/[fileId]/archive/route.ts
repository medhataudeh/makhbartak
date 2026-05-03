import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

interface ArchiveBody { note?: string }

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id: orderId, fileId } = await ctx.params;
  if (!isUuid(orderId) || !isUuid(fileId)) {
    return NextResponse.json({ error: "ids must be uuids" }, { status: 400 });
  }
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "lab" && auth.session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  let body: ArchiveBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("archive_result_file_admin", {
    p_file_id: fileId,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
    p_note: body?.note ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
