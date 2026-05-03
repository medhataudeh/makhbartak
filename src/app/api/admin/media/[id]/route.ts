import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

const BUCKET = "media";

// DELETE /api/admin/media/[id]
// Removes the row + the storage object. We do NOT scan packages/sliders/etc.
// for references — admins should swap the URL out before deleting. The
// admin UI calls this only when the operator confirms.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "id must be a uuid" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: row, error: getErr } = await sb
    .from("media_assets").select("id, storage_path").eq("id", id).maybeSingle();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error: rmErr } = await sb.storage.from(BUCKET).remove([row.storage_path]);
  if (rmErr) {
    console.warn("[api/admin/media/delete] storage remove failed", rmErr.message);
    // Continue — flagging deleted_at means it's hidden from the library
    // even if the storage object lingers; admin can re-run later.
  }
  const { error: dErr } = await sb
    .from("media_assets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

interface PatchBody { altTextAr?: string | null }

// PATCH /api/admin/media/[id] — small edits (alt text). Renaming the file
// is intentionally out of scope; admin re-uploads if the name matters.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "id must be a uuid" }, { status: 400 });
  let body: PatchBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = {};
  if (body.altTextAr !== undefined) patch.alt_text_ar = body.altTextAr;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });
  const { error } = await sb.from("media_assets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
