import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireCustomerSelfOrAdmin } from "@/lib/route-auth";

const BUCKET = "prescriptions";

// Phase 3.6: customer prescription upload. The browser POSTs multipart
// form-data with a single `file`. We store under
//   <customerId>/<timestamp>-<random>.<ext>
// and return the storage path. The path is then forwarded to
// /api/orders POST as payload.prescription_url; the customer / admin /
// lab UIs hydrate signed URLs at read time (same pattern as lab-results).
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
  // Reject non-image / oversized files. 8 MB is generous for a phone photo.
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
    return NextResponse.json({ error: "نوع الملف غير مدعوم — استخدم صورة أو PDF" }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "حجم الملف أكبر من 8MB" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || (file.type === "application/pdf" ? "pdf" : "jpg");
  const path = `${customerId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const sb = getSupabaseAdmin();
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) {
    console.error("[api/prescriptions] upload failed", { customerId, error: upErr.message });
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, path });
}
