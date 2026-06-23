// Client-safe invitation display helpers.
//
// This module is imported by BOTH the server (invite email builder, create
// route) and the client (the /invite/accept page), so it must stay free of
// any "server-only" import. It contains nothing secret: only Arabic display
// labels and human-readable permission summaries. The authoritative capability
// matrix lives in admin-permissions.ts and is NEVER shipped to the invite
// surface — we render the friendly summaries below instead of raw caps.

export type InviteTargetRole = "customer" | "nurse" | "lab" | "admin";
export type InviteAdminRole =
  | "super_admin" | "operations_admin" | "lab_admin"
  | "customer_support" | "finance_admin" | "content_admin";
export type InviteLabRole = "lab_admin" | "lab_accounting" | "lab_uploader";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

// Shape returned by get_platform_invitation_public (GET /api/invitations/[id]).
export interface InvitationPublic {
  id: string;
  email: string;
  invitedByName: string | null;
  invitedByRole: string | null;
  targetRole: InviteTargetRole;
  targetPortal: string | null;
  adminRole: InviteAdminRole | null;
  labRole: InviteLabRole | null;
  fullName: string | null;
  status: InviteStatus;
  expiresAt: string | null;
  acceptedAt: string | null;
  isExpired: boolean;
  lab?: {
    nameAr: string | null;
    city: string | null;
    area: string | null;
    phone: string | null;
    portalName: string | null;
  } | null;
}

// Which portal the invitee will land in.
export const PORTAL_LABELS: Record<InviteTargetRole, string> = {
  admin: "الإدارة",
  lab: "المختبر",
  nurse: "الممرض",
  customer: "العميل",
};

const ADMIN_ROLE_LABELS: Record<InviteAdminRole, string> = {
  super_admin: "مدير عام",
  operations_admin: "مدير العمليات",
  lab_admin: "مدير المختبرات",
  customer_support: "دعم العملاء",
  finance_admin: "مدير مالي",
  content_admin: "مدير المحتوى",
};

const LAB_ROLE_LABELS: Record<InviteLabRole, string> = {
  lab_admin: "مدير المختبر",
  lab_accounting: "محاسبة المختبر",
  lab_uploader: "مشغّل المختبر",
};

// Human-friendly role line shown under the portal (e.g. "مدير مالي").
export function inviteRoleLabel(inv: Pick<InvitationPublic, "targetRole" | "adminRole" | "labRole">): string {
  if (inv.targetRole === "admin" && inv.adminRole) return ADMIN_ROLE_LABELS[inv.adminRole];
  if (inv.targetRole === "lab" && inv.labRole) return LAB_ROLE_LABELS[inv.labRole];
  if (inv.targetRole === "nurse") return "ممرض زيارات منزلية";
  return "عميل";
}

// Safe, human-readable capability summary. NEVER the raw permission matrix.
const ADMIN_SUMMARIES: Record<InviteAdminRole, string[]> = {
  super_admin: ["صلاحيات إدارية كاملة"],
  operations_admin: ["إدارة الطلبات والإسناد والمتابعة التشغيلية"],
  finance_admin: ["متابعة المدفوعات والاستردادات والمحافظ والتسويات"],
  customer_support: ["متابعة الطلبات ودعم العملاء دون صلاحيات مالية حساسة"],
  lab_admin: ["إدارة المختبرات وطلباتها ونتائجها"],
  content_admin: ["إدارة المحتوى والباقات والوسائط"],
};

const LAB_SUMMARIES: Record<InviteLabRole, string[]> = {
  lab_admin: ["إدارة المختبر بالكامل: الطلبات، رفع النتائج، المشاكل، والإعدادات"],
  lab_accounting: ["متابعة مالية المختبر والتسويات إضافة إلى الطلبات والنتائج"],
  lab_uploader: ["إدارة طلبات المختبر، رفع النتائج، ومتابعة مشاكل المختبر"],
};

export function invitePermissionSummary(
  inv: Pick<InvitationPublic, "targetRole" | "adminRole" | "labRole">,
): string[] {
  if (inv.targetRole === "admin" && inv.adminRole) return ADMIN_SUMMARIES[inv.adminRole];
  if (inv.targetRole === "lab" && inv.labRole) return LAB_SUMMARIES[inv.labRole];
  if (inv.targetRole === "nurse") {
    return ["استقبال زيارات المنزل، تحصيل العينات، وتتبّع المسار اليومي"];
  }
  return ["حجز التحاليل المنزلية ومتابعة نتائجك"];
}

export const PLATFORM_NAME_AR = "مختبرتك";
