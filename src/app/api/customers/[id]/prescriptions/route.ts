import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireCustomerSelfOrAdmin } from "@/lib/route-auth";
import { detectImageOrPdf, mimeOf, extOf, SAFE_FORMATS } from "@/lib/payments/magic-bytes";
import { logger } from "@/lib/logger";

const BUCKET = "prescriptions";

// Phase 3.6 + 5.1: customer prescription upload. Browser POSTs multipart
// form-data with a single `file`. We sniff the magic bytes server-side
// (browser Content-Type is spoofable) and reject anything that's not a
// safe raster image or PDF. Bucket is private; signed URLs are minted at
// hydrate time elsewhere.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await ctx.params;
  if (!isUuid(customerId)) {
    return NextResponse.json({ error: "customer id must be a uuid" }, { status: 400 });
  }
  const auth = await requireCustomerSelfOrAdmin(customerId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "حجم الملف أكبر من 8MB" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const detected = detectImageOrPdf(buf);
  if (!SAFE_FORMATS.prescription.has(detected)) {
    return NextResponse.json(
      { error: "صيغة الملف غير مدعومة. الرجاء رفع PNG أو JPG أو WEBP أو PDF." },
      { status: 415 },
    );
  }

  const ext = extOf(detected);
  const trustedMime = mimeOf(detected);
  const path = `${customerId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const sb = getSupabaseAdmin();
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buf, {
    contentType: trustedMime,
    upsert: false,
  });
  if (upErr) {
    logger.error("api/prescriptions upload failed", {
      route: "api/customers/prescriptions",
      customerId, code: upErr.message,
    });
    return NextResponse.json({ error: "تعذر رفع الملف، حاول مرة أخرى" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, path });
}
