import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  const sessionRaw = form.get("session");
  const fileName = (form.get("fileName") as string | null) ?? null;
  const replacesFileId = (form.get("replacesFileId") as string | null) ?? null;
  const note = (form.get("note") as string | null) ?? null;

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file exceeds 25MB cap" }, { status: 413 });
  }
  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "only application/pdf is accepted" }, { status: 415 });
  }
  if (typeof sessionRaw !== "string") {
    return NextResponse.json({ error: "session required" }, { status: 401 });
  }
  let session: AuthSession;
  try {
    session = JSON.parse(sessionRaw) as AuthSession;
  } catch {
    return NextResponse.json({ error: "invalid session json" }, { status: 400 });
  }
  if (session.role !== "lab" && session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  if (replacesFileId && !isUuid(replacesFileId)) {
    return NextResponse.json({ error: "replacesFileId must be a uuid" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Verify the order exists and has an assigned lab. The RPC will also
  // raise on the lab_id check, but a clean 404 / 409 here is more useful.
  const { data: order, error: orderErr } = await sb
    .from("orders").select("id, lab_id").eq("id", orderId).maybeSingle();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });
  if (!order.lab_id) {
    return NextResponse.json({ error: "order has no assigned lab; assign one first" }, { status: 409 });
  }

  // Build the storage path: <orderId>/<rand>-<safe filename>. The leading
  // segment matches the lab-results bucket RLS convention from migration
  // 005 (split_part(name, '/', 1) = order.id) — service-role bypasses
  // those policies, but the convention keeps future authenticated paths
  // working without a re-key.
  const safeName = (fileName ?? file.name).replace(/[^A-Za-z0-9._؀-ۿ-]/g, "_");
  const rand = Math.random().toString(36).slice(2, 10);
  const storagePath = `${orderId}/${rand}-${safeName}`;

  const buf = Buffer.from(await file.arrayBuffer());
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
    p_actor_role: session.role,
    p_actor_id: null,
    p_actor_name: session.name ?? null,
    p_mime_type: "application/pdf",
    p_size_bytes: file.size,
    p_replaces_id: replacesFileId,
    p_note: note,
  });
  if (rpcErr) {
    // Best-effort cleanup: if the RPC failed but the storage object landed,
    // remove it so the bucket doesn't accumulate orphans.
    await sb.storage.from("lab-results").remove([storagePath]).catch(() => null);
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched, fileId: newId });
}
