import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";
import { adminHas, type AdminCapability } from "@/lib/admin-permissions";
import { logAdminActivity } from "@/lib/admin-activity";
import { logger } from "@/lib/logger";

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
  if (pErr) {
    logger.error("admin/users profile lookup failed", { route: "api/admin/users/[id]", id, code: pErr.code });
    return NextResponse.json({ error: "تعذر قراءة المستخدم" }, { status: 500 });
  }
  if (!profile) return NextResponse.json({ error: "user not found" }, { status: 404 });

  // Cap depends on the target's role: editing an admin user requires
  // users.write.admins (super only); editing a customer/nurse/lab user
  // requires users.write (super, ops, support today).
  const cap: AdminCapability = profile.role === "admin" ? "users.write.admins" : "users.write";
  if (!adminHas(auth.session.adminRole, cap)) {
    logger.warn("admin-cap denied", {
      route: "api/admin/users/[id]",
      cap, userId: auth.session.userId, adminRole: auth.session.adminRole,
    });
    return NextResponse.json(
      { error: "لا تملك صلاحية الوصول إلى هذه العملية" },
      { status: 403 },
    );
  }

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
    if (error) {
      logger.error("admin/users patch failed", { route: "api/admin/users/[id]", id, code: error.code });
      return NextResponse.json({ error: "تعذر حفظ بيانات المستخدم" }, { status: 500 });
    }
  }

  // Role-specific updates.
  if (profile.role === "nurse") {
    const nursePatch: Record<string, unknown> = {};
    if (body.city != null) nursePatch.city = body.city;
    if (body.isActive != null) nursePatch.is_active = body.isActive;
    if (Object.keys(nursePatch).length) {
      const { error } = await sb.from("nurses").update(nursePatch).eq("profile_id", id);
      if (error) {
      logger.error("admin/users patch failed", { route: "api/admin/users/[id]", id, code: error.code });
      return NextResponse.json({ error: "تعذر حفظ بيانات المستخدم" }, { status: 500 });
    }
    }
  } else if (profile.role === "lab") {
    const labUserPatch: Record<string, unknown> = {};
    if (body.labId != null) {
      if (!isUuid(body.labId)) {
        return NextResponse.json({ error: "labId must be a uuid" }, { status: 400 });
      }
      // Phase 5.1 — verify the target lab actually exists and is not soft-deleted
      // before reassigning a lab user. Previously the column would update blindly.
      const { data: targetLab, error: labErr } = await sb
        .from("labs").select("id").eq("id", body.labId).is("deleted_at", null).maybeSingle();
      if (labErr) {
        logger.error("admin/users lab lookup failed", { route: "api/admin/users/[id]", code: labErr.code });
        return NextResponse.json({ error: "تعذر التحقق من المختبر" }, { status: 500 });
      }
      if (!targetLab) {
        return NextResponse.json({ error: "المختبر المستهدف غير موجود" }, { status: 404 });
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
      if (error) {
      logger.error("admin/users patch failed", { route: "api/admin/users/[id]", id, code: error.code });
      return NextResponse.json({ error: "تعذر حفظ بيانات المستخدم" }, { status: 500 });
    }
    }
  }

  const changedKeys = [
    ...Object.keys(body ?? {}).filter((k) => (body as Record<string, unknown>)[k] != null),
  ];
  await logAdminActivity(
    sb,
    auth.session,
    "user_edit",
    "user",
    id,
    `update:${profile.role}${changedKeys.length ? `:${changedKeys.join(",")}` : ""}`,
  );

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

  // Cap depends on the target's role — same rule as PATCH.
  const { data: targetProfile, error: tpErr } = await sb
    .from("profiles").select("role").eq("id", id).maybeSingle();
  if (tpErr) {
    logger.error("admin/users target lookup failed", { route: "api/admin/users/[id]", id, code: tpErr.code });
    return NextResponse.json({ error: "تعذر قراءة المستخدم" }, { status: 500 });
  }
  if (!targetProfile) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  const cap: AdminCapability = targetProfile.role === "admin" ? "users.write.admins" : "users.write";
  if (!adminHas(auth.session.adminRole, cap)) {
    logger.warn("admin-cap denied", {
      route: "api/admin/users/[id]",
      cap, userId: auth.session.userId, adminRole: auth.session.adminRole,
    });
    return NextResponse.json(
      { error: "لا تملك صلاحية الوصول إلى هذه العملية" },
      { status: 403 },
    );
  }

  const { error } = await sb.auth.admin.deleteUser(id);
  if (error) {
    logger.error("admin/users delete failed", { route: "api/admin/users/[id]", id, code: error.code });
    return NextResponse.json({ error: "تعذر حذف المستخدم" }, { status: 500 });
  }

  await logAdminActivity(
    sb,
    auth.session,
    "user_edit",
    "user",
    id,
    `delete:${targetProfile.role}`,
  );

  return NextResponse.json({ ok: true });
}
