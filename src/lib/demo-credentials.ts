// Phase 8 demo credentials. Shown under the LoginForm collapsible only when
// NEXT_PUBLIC_SHOW_DEMO_CREDS is "true" (or in flag-off mock mode where
// pilot security doesn't apply yet). Rotate via auth.admin.updateUserById
// before any real pilot starts.
import type { Role } from "@/lib/types";

// Phase 5.1 hard guard: refuse to ship with the demo banner in production.
// This module is imported by the LoginForm; the assertion runs at build time
// for client bundles and at boot time on the server. NEXT_PUBLIC_* vars are
// inlined at build, so a misconfiguration is caught before traffic lands.
if (
  process.env.NODE_ENV === "production" &&
  (process.env.NEXT_PUBLIC_SHOW_DEMO_CREDS ?? "").toLowerCase() === "true"
) {
  throw new Error(
    "[demo-credentials] NEXT_PUBLIC_SHOW_DEMO_CREDS must not be 'true' in production",
  );
}

export interface DemoCredential {
  label: string;
  email: string;
  password: string;
}

export const DEMO_CUSTOMER_CREDENTIALS: DemoCredential[] = [
  { label: "أحمد محمد علي",   email: "customer1@phase1.invalid", password: "phase1-mock-password-do-not-use" },
  { label: "فاطمة الحسن",     email: "customer2@phase1.invalid", password: "phase1-mock-password-do-not-use" },
];

export const DEMO_NURSE_CREDENTIALS: DemoCredential[] = [
  { label: "محمد الأحمد",      email: "nurse1@phase3.invalid",    password: "phase3-mock-password-do-not-use" },
  { label: "سارة السيد",       email: "nurse2@phase3.invalid",    password: "phase3-mock-password-do-not-use" },
];

export const DEMO_ADMIN_CREDENTIALS: DemoCredential[] = [
  { label: "مدير عام (super_admin)",       email: "admin@phase8.invalid",   password: "phase8-admin-demo-password-do-not-use" },
  { label: "مدير العمليات",                email: "ops@phase8.invalid",     password: "phase8-admin-demo-password-do-not-use" },
  { label: "مدير المخبر",                  email: "lab@phase8.invalid",     password: "phase8-admin-demo-password-do-not-use" },
  { label: "دعم العملاء",                  email: "support@phase8.invalid", password: "phase8-admin-demo-password-do-not-use" },
  { label: "مدير المالية",                 email: "finance@phase8.invalid", password: "phase8-admin-demo-password-do-not-use" },
  { label: "مدير المحتوى",                 email: "content@phase8.invalid", password: "phase8-admin-demo-password-do-not-use" },
];

export const DEMO_LAB_CREDENTIALS: DemoCredential[] = [
  { label: "د. عمر زين · مدير الشام",      email: "sham-admin@phase8.invalid", password: "phase8-lab-demo-password-do-not-use" },
  { label: "هيا الكفري · محاسبة الشام",    email: "sham-acct@phase8.invalid",  password: "phase8-lab-demo-password-do-not-use" },
  { label: "د. سارة الحلبي · مدير النور",  email: "noor-admin@phase8.invalid", password: "phase8-lab-demo-password-do-not-use" },
  { label: "ريم القاسم · محاسبة النور",    email: "noor-acct@phase8.invalid",  password: "phase8-lab-demo-password-do-not-use" },
];

export function demoCredentialsFor(role: Role): DemoCredential[] {
  switch (role) {
    case "customer": return DEMO_CUSTOMER_CREDENTIALS;
    case "nurse":    return DEMO_NURSE_CREDENTIALS;
    case "admin":    return DEMO_ADMIN_CREDENTIALS;
    case "lab":      return DEMO_LAB_CREDENTIALS;
  }
}
