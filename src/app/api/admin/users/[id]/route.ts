import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

const ADMIN_SUB_ROLES = [
  "super_admin", "operations_admin", "lab_admin",
  "customer_support", "finance_admin", "content_admin",
] as const;
const LAB_SUB_ROLES = ["lab_admin", "lab_accounting", "lab_uploader"] as const;

interface PatchUserBody {
  fullName?: string;
  phone?: string;
  isActive?: boolean;
  adminRole?: typeof ADMIN_SUB_ROLES[number];
  city?: string;
  photoUrl?: string;
  labId?: string;
  labRole?: typeof LAB_SUB_ROLES[number];
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "user id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: PatchUserBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: profile, error: pErr } = await sb
    .from("profiles").select("role").eq("id", id).maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!profile) return NextResponse.json({ error: "user not found" }, { status: 404 });

  // Profile-level updates.
  const profilePatch: Record<string, unknown> = {};
  if (body.fullName != null) profilePatch.full_name = body.fullName;
  if (body.phone != null) profilePatch.phone = body.phone;
  if (body.isActive != null) profilePatch.is_active = body.isActive;
  if (body.photoUrl != null) profilePatch.photo_url = body.photoUrl;
  if (profile.role === "admin" && body.adminRole != null) {
    if (!ADMIN_SUB_ROLES.includes(body.adminRole)) {
      return NextResponse.json({ error: "invalid adminRole" }, { status: 400 });
    }
    profilePatch.admin_role = body.adminRole;
  }
  if (Object.keys(profilePatch).length) {
    const { error } = await sb.from("profiles").update(profilePatch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Role-specific updates.
  if (profile.role === "nurse") {
    const nursePatch: Record<string, unknown> = {};
    if (body.city != null) nursePatch.city = body.city;
    if (body.isActive != null) nursePatch.is_active = body.isActive;
    if (Object.keys(nursePatch).length) {
      const { error } = await sb.from("nurses").update(nursePatch).eq("profile_id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else if (profile.role === "lab") {
    const labUserPatch: Record<string, unknown> = {};
    if (body.labId != null) {
      if (!isUuid(body.labId)) {
        return NextResponse.json({ error: "labId must be a uuid" }, { status: 400 });
      }
      labUserPatch.lab_id = body.labId;
    }
    if (body.labRole != null) {
      if (!LAB_SUB_ROLES.includes(body.labRole)) {
        return NextResponse.json({ error: "invalid labRole" }, { status: 400 });
      }
      labUserPatch.role = body.labRole;
    }
    if (body.isActive != null) labUserPatch.is_active = body.isActive;
    if (Object.keys(labUserPatch).length) {
      const { error } = await sb.from("lab_users").update(labUserPatch).eq("profile_id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "user id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Refuse to delete the caller themselves to avoid bricking the dashboard.
  if (id === auth.session.userId) {
    return NextResponse.json({ error: "cannot delete the currently signed-in admin" }, { status: 409 });
  }

  const sb = getSupabaseAdmin();
  const { error } = await sb.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
