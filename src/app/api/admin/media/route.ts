import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

const BUCKET = "media";

// GET /api/admin/media — list every media asset, newest first.
// Returns the public URL so the admin grid can render thumbnails directly.
// Admin-only by route guard; service-role bypasses RLS.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("media_assets")
    .select("id, storage_path, file_name, mime_type, size_bytes, width, height, alt_text_ar, uploaded_by, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[api/admin/media] list failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const enriched = (data ?? []).map((row) => {
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(row.storage_path);
    return { ...row, public_url: pub.publicUrl };
  });
  return NextResponse.json({ assets: enriched });
}

// POST /api/admin/media (multipart/form-data: file, altTextAr?)
// Uploads to the `media` bucket and inserts a metadata row. Returns the
// public URL the admin can paste into a slider/package field — or that the
// MediaPicker can hand to its caller.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const fd = await req.formData().catch(() => null);
  if (!fd) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  const file = fd.get("file");
  const altTextAr = (fd.get("altTextAr") as string | null) ?? null;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "file is empty" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "file exceeds 10MB" }, { status: 413 });
  }
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"]);
  if (file.type && !allowed.has(file.type)) {
    return NextResponse.json({ error: `unsupported mime: ${file.type}` }, { status: 415 });
  }

  // Storage path: deterministic prefix per day so the bucket browser stays
  // organized. UUID component avoids collisions when two admins upload
  // files with the same name on the same day.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const now = new Date();
  const prefix = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const random = crypto.randomUUID();
  const storagePath = `${prefix}/${random}-${safeName}`;

  const sb = getSupabaseAdmin();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, buf, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    console.error("[api/admin/media] upload failed", upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { error: insErr, data: row } = await sb
    .from("media_assets")
    .insert({
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      alt_text_ar: altTextAr,
      uploaded_by: auth.session.userId,
    })
    .select("id, storage_path, file_name, mime_type, size_bytes, alt_text_ar, created_at")
    .single();
  if (insErr) {
    // Best-effort cleanup: don't leave a Storage object orphaned by a failed insert.
    await sb.storage.from(BUCKET).remove([storagePath]).catch(() => null);
    console.error("[api/admin/media] metadata insert failed", insErr.message);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
  return NextResponse.json({ asset: { ...row, public_url: pub.publicUrl } });
}
