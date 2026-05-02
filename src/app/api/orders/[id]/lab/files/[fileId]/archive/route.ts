import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface ArchiveBody {
  session: AuthSession;
  note?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id: orderId, fileId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  if (!isUuid(fileId)) {
    return NextResponse.json({ error: "fileId must be a uuid" }, { status: 400 });
  }

  let body: ArchiveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, note } = body ?? {};
  if (!session) {
    return NextResponse.json({ error: "session required" }, { status: 401 });
  }
  if (session.role !== "lab" && session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("archive_result_file_admin", {
    p_file_id: fileId,
    p_actor_role: session.role,
    p_actor_id: null,
    p_actor_name: session.name ?? null,
    p_note: note ?? null,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
