import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import { detectImageOrPdf } from "@/lib/payments/magic-bytes";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "lab" && auth.session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  const fileName = (form.get("fileName") as string | null) ?? null;
  const replacesFileId = (form.get("replacesFileId") as string | null) ?? null;
  const note = (form.get("note") as string | null) ?? null;

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file exceeds 25MB cap" }, { status: 413 });
  }
  if (replacesFileId && !isUuid(replacesFileId)) {
    return NextResponse.json({ error: "replacesFileId must be a uuid" }, { status: 400 });
  }

  // Magic-byte sniff. The browser-supplied Content-Type is spoofable; only
  // a real PDF header (%PDF) is acceptable for the lab-results bucket.
  const buf = Buffer.from(await file.arrayBuffer());
  const detected = detectImageOrPdf(buf);
  if (detected !== "pdf") {
    return NextResponse.json({ error: "only application/pdf is accepted" }, { status: 415 });
  }

  const sb = getSupabaseAdmin();

  const { data: order, error: orderErr } = await sb
    .from("orders").select("id, lab_id").eq("id", orderId).maybeSingle();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });
  if (!order.lab_id) {
    return NextResponse.json({ error: "order has no assigned lab; assign one first" }, { status: 409 });
  }
  // Lab user can only upload to orders of their own lab.
  if (auth.session.role === "lab") {
    if (!auth.session.labId || order.lab_id !== auth.session.labId) {
      return NextResponse.json({ error: "this order is not assigned to your lab" }, { status: 403 });
    }
  }

  // When replacing, the predecessor must belong to this same order. For lab
  // sessions it must also belong to the caller's lab — otherwise a lab user
  // could archive another lab's file by passing its uuid as replacesFileId.
  if (replacesFileId) {
    const { data: predecessor, error: predErr } = await sb
      .from("lab_result_files")
      .select("id, order_id, lab_id, status")
      .eq("id", replacesFileId)
      .maybeSingle();
    if (predErr) {
      return NextResponse.json({ error: "تعذر قراءة الملف السابق" }, { status: 500 });
    }
    if (!predecessor) {
      return NextResponse.json({ error: "الملف السابق غير موجود" }, { status: 404 });
    }
    if (predecessor.order_id !== orderId) {
      return NextResponse.json({ error: "الملف السابق لا يتبع هذا الطلب" }, { status: 400 });
    }
    if (auth.session.role === "lab" && predecessor.lab_id !== auth.session.labId) {
      return NextResponse.json(
        { error: "لا تملك صلاحية استبدال هذا الملف" },
        { status: 403 },
      );
    }
  }

  const safeName = (fileName ?? file.name).replace(/[^A-Za-z0-9._؀-ۿ-]/g, "_");
  const rand = Math.random().toString(36).slice(2, 10);
  const storagePath = `${orderId}/${rand}-${safeName}`;

  const { error: uploadErr } = await sb.storage
    .from("lab-results")
    .upload(storagePath, buf, { contentType: "application/pdf", upsert: false });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: newId, error: rpcErr } = await sb.rpc("upload_result_file_admin", {
    p_order_id: orderId,
    p_storage_path: storagePath,
    p_file_name: safeName,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
    p_mime_type: "application/pdf",
    p_size_bytes: file.size,
    p_replaces_id: replacesFileId,
    p_note: note,
  });
  if (rpcErr) {
    await sb.storage.from("lab-results").remove([storagePath]).catch(() => null);
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched, fileId: newId });
}
