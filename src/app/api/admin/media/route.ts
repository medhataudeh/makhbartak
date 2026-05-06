import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";
import { ensureMediaInfra, MEDIA_BUCKET } from "@/lib/supabase/ensure-media-infra";
import { detectImageOrPdf, mimeOf, extOf, SAFE_FORMATS } from "@/lib/payments/magic-bytes";
import { logger } from "@/lib/logger";
import { safeApiError } from "@/lib/api/safe-error";

const BUCKET = MEDIA_BUCKET;

// GET /api/admin/media — list every media asset, newest first.
// Returns the public URL so the admin grid can render thumbnails directly.
// Admin-only by route guard; service-role bypasses RLS.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Best-effort self-heal: create the bucket if missing so a fresh project
  // doesn't need a migration round-trip before media management works.
  // Table absence still requires the migration; we surface that explicitly.
  const ensure = await ensureMediaInfra();
  if (!ensure.ok) {
    return NextResponse.json({ error: ensure.error, details: ensure.details }, { status: 500 });
  }
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

  // Self-heal first. If the bucket / table is missing on a fresh project we
  // create the bucket here and surface a precise Arabic error if the table
  // hasn't been migrated yet, instead of letting Storage return the cryptic
  // "Bucket not found".
  const ensure = await ensureMediaInfra();
  if (!ensure.ok) {
    return NextResponse.json({ error: ensure.error, details: ensure.details }, { status: 500 });
  }

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
    return NextResponse.json({ error: "حجم الملف أكبر من 10MB" }, { status: 413 });
  }

  // Phase 5.1 — server-side magic-byte sniff. Browser-supplied Content-Type
  // is trivially spoofed; SVG is rejected because it can carry inline scripts.
  const buf = Buffer.from(await file.arrayBuffer());
  const detected = detectImageOrPdf(buf);
  if (!SAFE_FORMATS.rasterOrGif.has(detected)) {
    return NextResponse.json(
      { error: "صيغة الملف غير مدعومة. الرجاء رفع PNG أو JPG أو WEBP." },
      { status: 415 },
    );
  }

  // Storage path: deterministic prefix per day so the bucket browser stays
  // organized. UUID component avoids collisions when two admins upload
  // files with the same name on the same day. We deliberately use the
  // magic-byte-derived extension, not the user-supplied filename's tail.
  const baseName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/\.[a-zA-Z0-9]+$/, "");
  const ext = extOf(detected);
  const now = new Date();
  const prefix = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const random = crypto.randomUUID();
  const storagePath = `${prefix}/${random}-${baseName}.${ext}`;
  const trustedMime = mimeOf(detected);

  const sb = getSupabaseAdmin();
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: trustedMime, upsert: false });
  if (upErr) {
    const safe = safeApiError(upErr, {
      route: "api/admin/media",
      fallback: "تعذر رفع الملف، حاول مرة أخرى",
      context: { storagePath },
    });
    return NextResponse.json(safe.body, { status: safe.status });
  }

  const { error: insErr, data: row } = await sb
    .from("media_assets")
    .insert({
      storage_path: storagePath,
      file_name: file.name,
      mime_type: trustedMime,
      size_bytes: file.size,
      alt_text_ar: altTextAr,
      uploaded_by: auth.session.userId,
    })
    .select("id, storage_path, file_name, mime_type, size_bytes, alt_text_ar, created_at")
    .single();
  if (insErr) {
    await sb.storage.from(BUCKET).remove([storagePath]).catch(() => null);
    logger.error("api/admin/media metadata insert failed", { route: "api/admin/media", code: insErr.code });
    return NextResponse.json({ error: "تعذر حفظ بيانات الملف" }, { status: 500 });
  }
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
  return NextResponse.json({ asset: { ...row, public_url: pub.publicUrl } });
}
