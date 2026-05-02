"use client";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { LoginForm } from "@/components/auth/LoginForm";
import { adminFromSession, useSession, logout } from "@/lib/auth";
import { MOCK_ADMINS } from "@/lib/mock-data";
import { ROLE_LABELS } from "@/lib/types";

export default function AdminPage() {
  const session = useSession();
  const admin = adminFromSession(session);

  if (!session || session.role !== "admin" || !admin) {
    return (
      <LoginForm
        brandTitle="لوحة الإدارة — مختبرك"
        brandSubtitle="تسجيل دخول الموظفين"
        allowedRoles={["admin"]}
        onSuccess={() => { /* useSession() in this page re-renders */ }}
        demoCredentials={MOCK_ADMINS.map((a) => ({
          label: ROLE_LABELS[a.role],
          username: a.username,
          password: a.password,
        }))}
      />
    );
  }

  return <AdminDashboard user={admin} onLogout={logout} />;
}
