import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

interface PatchNurseBody {
  fullName?: string;
  phone?: string;
  city?: string;
  isActive?: boolean;
  photoUrl?: string;
}

// PATCH /api/admin/nurses/[id]
// Updates the operational nurse row + the linked profile in one call. The
// AdminDashboard NursesAdmin form hits this; it does NOT touch auth.users.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: PatchNurseBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: nurse, error: nurseErr } = await sb
    .from("nurses").select("id, profile_id").eq("id", id).maybeSingle();
  if (nurseErr) return NextResponse.json({ error: nurseErr.message }, { status: 500 });
  if (!nurse) return NextResponse.json({ error: "السجل غير موجود في قاعدة البيانات" }, { status: 404 });

  const nursePatch: Record<string, unknown> = {};
  if (body.city != null) nursePatch.city = body.city.trim() || null;
  if (body.isActive != null) nursePatch.is_active = !!body.isActive;
  if (Object.keys(nursePatch).length > 0) {
    const { error } = await sb.from("nurses").update(nursePatch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const profilePatch: Record<string, unknown> = {};
  if (body.fullName != null) profilePatch.full_name = body.fullName.trim();
  if (body.phone != null) profilePatch.phone = body.phone.trim() || null;
  if (body.photoUrl != null) profilePatch.photo_url = body.photoUrl || null;
  if (Object.keys(profilePatch).length > 0) {
    const { error } = await sb.from("profiles").update(profilePatch).eq("id", nurse.profile_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/nurses/[id] — soft delete by flagging the nurse inactive.
// We deliberately do NOT cascade into auth.users here; the dedicated
// /api/admin/users/[id] DELETE handles full account removal.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("nurses")
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
