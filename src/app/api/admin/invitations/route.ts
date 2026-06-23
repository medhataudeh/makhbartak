import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdminCap } from "@/lib/route-auth";
import { logAdminActivity } from "@/lib/admin-activity";
import { logger } from "@/lib/logger";
import { safeApiError } from "@/lib/api/safe-error";
import { sendEmail, isEmailConfigured } from "@/lib/server/email";
import { buildInvitationEmail } from "@/lib/server/emails/invitation";
import { PORTAL_LABELS, type InvitationPublic } from "@/lib/invitation";
import { ROLE_LABELS } from "@/lib/types";

export const runtime = "nodejs";

const TARGET_ROLES = ["customer", "nurse", "lab", "admin"] as const;
type TargetRole = (typeof TARGET_ROLES)[number];

const ADMIN_SUB_ROLES = [
  "super_admin", "operations_admin", "lab_admin",
  "customer_support", "finance_admin", "content_admin",
] as const;
const LAB_SUB_ROLES = ["lab_admin", "lab_accounting", "lab_uploader"] as const;

const INVITE_TTL_DAYS = 7;

interface CreateInviteBody {
  role: TargetRole;
  email: string;
  fullName: string;
  phone?: string;
  adminRole?: typeof ADMIN_SUB_ROLES[number];
  labId?: string;
  labRole?: typeof LAB_SUB_ROLES[number];
  city?: string;
}

// POST /api/admin/invitations — invite a user to a portal.
//
// Flow: validate caps + input → record the invitation row (RPC) → mint a
// Supabase Auth invite action-link (auth.admin.generateLink, which creates the
// auth user but does NOT send an email) → send our own Arabic email via Resend
// → log admin activity. Supabase still owns the credential/session; we own the
// email content + the app-level invitation metadata.
export async function POST(req: NextRequest) {
  let body: CreateInviteBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Authorization: inviting an admin needs the admin-staff cap (super only);
  // everything else needs users.write (super / ops). Mirrors POST /api/admin/users.
  const cap = body?.role === "admin" ? "users.write.admins" : "users.write";
  const auth = await requireAdminCap(cap);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!TARGET_ROLES.includes(body.role)) {
    return NextResponse.json({ error: "role must be customer | nurse | lab | admin" }, { status: 400 });
  }
  const email = body.email?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "بريد إلكتروني صالح مطلوب" }, { status: 400 });
  }
  if (!body.fullName?.trim()) {
    return NextResponse.json({ error: "الاسم الكامل مطلوب" }, { status: 400 });
  }
  if (body.role === "admin" && !ADMIN_SUB_ROLES.includes(body.adminRole as typeof ADMIN_SUB_ROLES[number])) {
    return NextResponse.json({ error: "دور الإدارة مطلوب" }, { status: 400 });
  }
  if (body.role === "lab") {
    if (!body.labId || !isUuid(body.labId)) {
      return NextResponse.json({ error: "معرّف المختبر مطلوب" }, { status: 400 });
    }
    if (!LAB_SUB_ROLES.includes(body.labRole as typeof LAB_SUB_ROLES[number])) {
      return NextResponse.json({ error: "دور مستخدم المختبر مطلوب" }, { status: 400 });
    }
  }

  const sb = getSupabaseAdmin();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // 1. Record the invitation (RPC owns validation of role/lab invariants).
  const { data: created, error: createErr } = await sb.rpc("create_platform_invitation", {
    p_email:              email,
    p_target_role:        body.role,
    p_invited_by_user_id: auth.session.userId,
    p_invited_by_name:    auth.session.fullName ?? null,
    p_invited_by_role:    auth.session.adminRole ? ROLE_LABELS[auth.session.adminRole] : "الإدارة",
    p_full_name:          body.fullName.trim(),
    p_phone:              body.phone?.trim() ?? null,
    p_admin_role:         body.role === "admin" ? body.adminRole : null,
    p_lab_id:             body.role === "lab" ? body.labId : null,
    p_lab_role:           body.role === "lab" ? body.labRole : null,
    p_city:               body.city?.trim() ?? null,
    p_target_portal:      PORTAL_LABELS[body.role],
    p_expires_at:         expiresAt,
  });
  if (createErr || !created?.id) {
    const { status, body: errBody } = safeApiError(createErr, {
      route: "api/admin/invitations",
      fallback: "تعذر إنشاء الدعوة",
    });
    return NextResponse.json(errBody, { status });
  }
  const invitationId = created.id as string;

  // 2. Mint the Supabase Auth invite link (creates the auth user, no email).
  const base = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://app.medhataudeh.com").replace(/\/+$/, "");
  const redirectTo = `${base}/invite/accept?invitation=${invitationId}`;
  const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      redirectTo,
      data: {
        full_name: body.fullName.trim(),
        invitation_id: invitationId,
        target_role: body.role,
        ...(body.role === "lab" ? { lab_id: body.labId } : {}),
      },
    },
  });
  if (linkErr || !linkData?.properties?.action_link) {
    // Roll back our just-created invitation row so we don't strand a pending
    // invite with no backing auth user. Most common cause: email already has
    // an account.
    await sb.from("platform_invitations").delete().eq("id", invitationId).then(() => null, () => null);
    logger.error("invite generateLink failed", {
      route: "api/admin/invitations",
      invitationId,
      message: linkErr?.message,
    });
    const exists = (linkErr?.message ?? "").toLowerCase().includes("already");
    return NextResponse.json(
      { error: exists ? "هذا البريد مسجّل مسبقاً في النظام" : "تعذر إنشاء رابط الدعوة" },
      { status: exists ? 409 : 500 },
    );
  }
  const acceptUrl = linkData.properties.action_link;

  // 3. Fetch the display-safe invitation view (with lab join) to render email.
  const { data: pub } = await sb.rpc("get_platform_invitation_public", { p_id: invitationId });
  const invPublic = (pub ?? null) as InvitationPublic | null;

  // 4. Send our Arabic email. A mail failure does not fail the invite — the
  //    link is returned so the admin can deliver it manually.
  let emailSent = false;
  if (invPublic && isEmailConfigured()) {
    const mail = buildInvitationEmail(invPublic, acceptUrl);
    const res = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text, kind: "invitation" });
    emailSent = res.ok;
  } else if (!isEmailConfigured()) {
    logger.warn("invite created but email transport not configured", {
      route: "api/admin/invitations", invitationId,
    });
  }

  // 5. Audit.
  await logAdminActivity(
    sb,
    auth.session,
    "user_edit",
    "invitation",
    invitationId,
    `invite:${body.role}${body.adminRole ? `:${body.adminRole}` : ""}${body.labRole ? `:${body.labRole}` : ""}`,
  );

  return NextResponse.json({
    id: invitationId,
    ok: true,
    emailSent,
    // Returned so an admin can copy/deliver the link if email is unconfigured
    // or bounced. This route is admin-capped, so exposing it here is safe.
    inviteLink: emailSent ? undefined : acceptUrl,
  });
}
