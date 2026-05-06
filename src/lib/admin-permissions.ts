// F7 — admin sub-role capability matrix.
//
// One source of truth for what every admin sub-role is allowed to do at the
// API layer. Routes call `requireAdminCap("<cap>")` from `route-auth.ts`;
// that helper resolves the caller's `adminRole` and consults the matrix
// below. The UI's `ROLE_PERMISSIONS` (section visibility) stays separate
// for now — see CLAUDE.md / F7 plan §6.
//
// Phase 1 scope: finance, payouts, settlements, refunds, force-complete,
// users CRUD, app-settings PATCH. Operational + catalog routes ship in
// Phase 2/3 with additional caps.
//
// Tightening rules:
//   * super_admin holds every cap.
//   * Caps that touch money OUT (refund), bypass payment gates
//     (force-complete), edit admin staff (users.write.admins,
//     users.reset_password), or change finance-sensitive config
//     (system.app_settings.write) are super_admin only.
//   * lab_admin sees lab-scoped finance only — no nurse wallets, no global
//     overview, no global reports.
//   * customer_support reads customer profiles for support work but does
//     NOT have users.write today; revisit if a confirmed support edit
//     workflow lands.

// AdminRole and AdminSubRole are the same union; we source from `./types`
// (a client-safe module) so admin-permissions.ts can be imported from both
// server and client code without dragging in the "server-only" guard from
// route-auth.ts.
import type { AdminRole as AdminSubRole } from "./types";

export type AdminCapability =
  // Finance reads
  | "finance.read"           // global finance read (overview, reports, nurse wallets, settlements list)
  | "finance.read.labs"      // lab-scoped finance read (lab settlements, payout rules) — narrower
  // Finance writes
  | "finance.refund"
  | "finance.verify"
  | "finance.cash"
  | "finance.coupon"
  | "finance.payout_rules"
  | "finance.settlement.write"
  // Operations writes
  | "operations.cancel"
  | "operations.force_complete"
  // Users / staff
  | "users.read"
  | "users.read.admins"
  | "users.write"
  | "users.write.admins"
  | "users.reset_password"
  // System
  | "system.app_settings.read"
  | "system.app_settings.write";

const ALL_CAPS: ReadonlySet<AdminCapability> = new Set<AdminCapability>([
  "finance.read",
  "finance.read.labs",
  "finance.refund",
  "finance.verify",
  "finance.cash",
  "finance.coupon",
  "finance.payout_rules",
  "finance.settlement.write",
  "operations.cancel",
  "operations.force_complete",
  "users.read",
  "users.read.admins",
  "users.write",
  "users.write.admins",
  "users.reset_password",
  "system.app_settings.read",
  "system.app_settings.write",
]);

export const ADMIN_CAPS: Readonly<Record<AdminSubRole, ReadonlySet<AdminCapability>>> = {
  super_admin: ALL_CAPS,

  finance_admin: new Set<AdminCapability>([
    "finance.read",
    "finance.read.labs",
    "finance.refund",
    "finance.verify",
    "finance.cash",
    "finance.coupon",
    "finance.payout_rules",
    "finance.settlement.write",
    "system.app_settings.read",
  ]),

  operations_admin: new Set<AdminCapability>([
    "finance.read",
    "finance.read.labs",
    "finance.cash",
    "finance.coupon",
    "operations.cancel",
    "users.read",
    "users.write",
    "system.app_settings.read",
  ]),

  customer_support: new Set<AdminCapability>([
    "operations.cancel",
    "users.read",
    // No users.write today — support is view+search only. Revisit if a
    // confirmed support edit workflow lands.
  ]),

  lab_admin: new Set<AdminCapability>([
    // Lab-scoped finance only. No global finance.read so the lab admin
    // never sees nurse wallets, global overview, or global reports.
    "finance.read.labs",
  ]),

  content_admin: new Set<AdminCapability>([
    // Phase-1 caps don't touch catalog/content. Catalog caps land in
    // Phase 3. Read-only access to admin system settings is granted so the
    // content team can review operational config without the write power
    // that Stripe keys / commission rates demand.
    "system.app_settings.read",
  ]),
};

export function adminHas(
  role: AdminSubRole | undefined,
  cap: AdminCapability,
): boolean {
  if (!role) return false;
  return ADMIN_CAPS[role]?.has(cap) ?? false;
}
