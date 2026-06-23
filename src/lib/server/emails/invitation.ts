import "server-only";
import {
  type InvitationPublic,
  PORTAL_LABELS,
  PLATFORM_NAME_AR,
  inviteRoleLabel,
  invitePermissionSummary,
} from "@/lib/invitation";

// Builds the Arabic, RTL invitation email (HTML + plain-text). No external
// images, no tracking pixels — just inline-styled, table-based markup that
// renders in mobile mail clients. All dynamic values are HTML-escaped.
//
// Intentionally EXCLUDED (see task spec): service keys, internal IDs beyond
// the opaque accept link, raw permission JSON, finance rules, settlement
// data, provider secrets.

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("ar-SY-u-nu-latn", {
      year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildInvitationEmail(inv: InvitationPublic, acceptUrl: string): BuiltEmail {
  const portal = PORTAL_LABELS[inv.targetRole];
  const roleLabel = inviteRoleLabel(inv);
  const summary = invitePermissionSummary(inv);
  const inviter = inv.invitedByName?.trim() || "أحد مسؤولي المنصة";
  const expiry = formatExpiry(inv.expiresAt);

  const subject = `دعوة للانضمام إلى ${PLATFORM_NAME_AR} — بوابة ${portal}`;

  // ── plain text ──
  const textLines = [
    `${PLATFORM_NAME_AR} — دعوة للانضمام`,
    "",
    `دعاك ${inviter} للانضمام إلى بوابة ${portal} على منصة ${PLATFORM_NAME_AR}.`,
    inv.invitedByRole ? `صفة الداعي: ${inv.invitedByRole}` : "",
    `البريد المدعو: ${inv.email}`,
    `الدور: ${roleLabel}`,
    "",
    "الصلاحيات:",
    ...summary.map((s) => `• ${s}`),
  ];
  if (inv.targetRole === "lab" && inv.lab) {
    textLines.push("", "تفاصيل المختبر:");
    if (inv.lab.nameAr) textLines.push(`• المختبر: ${inv.lab.nameAr}`);
    const loc = [inv.lab.city, inv.lab.area].filter(Boolean).join(" - ");
    if (loc) textLines.push(`• الموقع: ${loc}`);
    if (inv.lab.phone) textLines.push(`• الهاتف: ${inv.lab.phone}`);
  }
  if (expiry) textLines.push("", `صلاحية الدعوة حتى: ${expiry}`);
  textLines.push(
    "",
    `لقبول الدعوة افتح الرابط التالي وعيّن كلمة المرور:`,
    acceptUrl,
    "",
    "إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل الرسالة.",
  );
  const text = textLines.filter((l) => l !== undefined).join("\n");

  // ── HTML ──
  const summaryHtml = summary
    .map((s) => `<li style="margin:0 0 6px;">${esc(s)}</li>`)
    .join("");

  const labHtml =
    inv.targetRole === "lab" && inv.lab
      ? `
      <tr><td style="padding:16px 0 0;">
        <div style="font-size:13px;font-weight:700;color:#164E63;margin-bottom:8px;">تفاصيل المختبر</div>
        <table role="presentation" width="100%" style="font-size:14px;color:#374151;border-collapse:collapse;">
          ${inv.lab.nameAr ? `<tr><td style="padding:3px 0;color:#6b7280;">المختبر</td><td style="padding:3px 0;font-weight:600;">${esc(inv.lab.nameAr)}</td></tr>` : ""}
          ${[inv.lab.city, inv.lab.area].filter(Boolean).length ? `<tr><td style="padding:3px 0;color:#6b7280;">الموقع</td><td style="padding:3px 0;">${esc([inv.lab.city, inv.lab.area].filter(Boolean).join(" - "))}</td></tr>` : ""}
          ${inv.lab.phone ? `<tr><td style="padding:3px 0;color:#6b7280;">الهاتف</td><td style="padding:3px 0;direction:ltr;text-align:right;">${esc(inv.lab.phone)}</td></tr>` : ""}
        </table>
      </td></tr>`
      : "";

  const expiryHtml = expiry
    ? `<tr><td style="padding:14px 0 0;font-size:13px;color:#6b7280;">صلاحية الدعوة حتى: <span style="color:#164E63;font-weight:600;">${esc(expiry)}</span></td></tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Readex Pro',-apple-system,Segoe UI,Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" style="background:#f3f4f6;padding:24px 0;border-collapse:collapse;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;border-collapse:collapse;">
        <tr><td style="background:#0891B2;padding:20px 24px;">
          <div style="color:#ffffff;font-size:20px;font-weight:700;">${esc(PLATFORM_NAME_AR)}</div>
          <div style="color:#cffafe;font-size:13px;margin-top:2px;">دعوة للانضمام إلى المنصة</div>
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 14px;font-size:15px;color:#111827;line-height:1.7;">
            دعاك <strong>${esc(inviter)}</strong>${inv.invitedByRole ? ` (${esc(inv.invitedByRole)})` : ""}
            للانضمام إلى <strong>بوابة ${esc(portal)}</strong> على منصة ${esc(PLATFORM_NAME_AR)}.
          </p>

          <table role="presentation" width="100%" style="font-size:14px;color:#374151;border-collapse:collapse;margin:4px 0 8px;">
            <tr><td style="padding:3px 0;color:#6b7280;width:90px;">البريد</td><td style="padding:3px 0;font-weight:600;direction:ltr;text-align:right;">${esc(inv.email)}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;">البوابة</td><td style="padding:3px 0;font-weight:600;">${esc(portal)}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;">الدور</td><td style="padding:3px 0;font-weight:600;">${esc(roleLabel)}</td></tr>
          </table>

          <div style="font-size:13px;font-weight:700;color:#164E63;margin:14px 0 6px;">الصلاحيات</div>
          <ul style="margin:0;padding-inline-start:20px;font-size:14px;color:#374151;line-height:1.6;">${summaryHtml}</ul>

          <table role="presentation" width="100%" style="border-collapse:collapse;">${labHtml}${expiryHtml}</table>

          <table role="presentation" width="100%" style="margin:24px 0 8px;border-collapse:collapse;">
            <tr><td align="center">
              <a href="${esc(acceptUrl)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 32px;border-radius:14px;">قبول الدعوة</a>
            </td></tr>
          </table>

          <p style="margin:18px 0 0;font-size:12px;color:#9ca3af;line-height:1.6;text-align:center;">
            إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل الرسالة.
          </p>
        </td></tr>
      </table>
      <div style="max-width:520px;color:#9ca3af;font-size:11px;margin-top:14px;">${esc(PLATFORM_NAME_AR)}</div>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
