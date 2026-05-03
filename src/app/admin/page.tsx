"use client";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { LoginForm } from "@/components/auth/LoginForm";
import { useSession, logout } from "@/lib/auth";
import { DEMO_ADMIN_CREDENTIALS } from "@/lib/demo-credentials";
import type { AdminUser } from "@/lib/types";

const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_CREDS === "true";

export default function AdminPage() {
  const session = useSession();

  if (!session || session.role !== "admin") {
    return (
      <LoginForm
        brandTitle="لوحة الإدارة — مختبرك"
        brandSubtitle="تسجيل دخول الموظفين"
        allowedRoles={["admin"]}
        onSuccess={() => { /* useSession() in this page re-renders */ }}
        demoCredentials={SHOW_DEMO ? DEMO_ADMIN_CREDENTIALS.map((c) => ({
          label: c.label, username: c.email, password: c.password,
        })) : undefined}
      />
    );
  }

  // Phase 8: synthesize the AdminUser shape AdminDashboard expects from
  // the enriched session. role-specific permissions are keyed on
  // session.adminRole (the AdminRole sub-type).
  const adminUser: AdminUser = {
    id: session.userId,
    username: session.username,
    password: "",
    name: session.name || session.username,
    role: session.adminRole ?? "super_admin",
    isActive: true,
  };

  return <AdminDashboard user={adminUser} onLogout={logout} />;
}
