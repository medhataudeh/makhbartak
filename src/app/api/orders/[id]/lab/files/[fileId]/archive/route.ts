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

  // Ownership pre-flight. The RPC takes a bare file id and would happily
  // archive a file from a different order or a different lab. Refuse here
  // before any state change.
  const { data: file, error: fileErr } = await sb
    .from("lab_result_files")
    .select("id, order_id, lab_id")
    .eq("id", fileId)
    .maybeSingle();
  if (fileErr) {
    return NextResponse.json({ error: "تعذر قراءة ملف النتيجة" }, { status: 500 });
  }
  if (!file) {
    return NextResponse.json({ error: "ملف النتيجة غير موجود" }, { status: 404 });
  }
  if (file.order_id !== orderId) {
    return NextResponse.json({ error: "الملف لا يتبع هذا الطلب" }, { status: 400 });
  }
  if (auth.session.role === "lab") {
    if (!auth.session.labId || file.lab_id !== auth.session.labId) {
      return NextResponse.json(
        { error: "لا تملك صلاحية أرشفة ملفات هذا الطلب" },
        { status: 403 },
      );
    }
  }

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
