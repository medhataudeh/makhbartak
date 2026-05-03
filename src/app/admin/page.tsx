"use client";
import { useState } from "react";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { LoginForm } from "@/components/auth/LoginForm";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { AuthLoading } from "@/components/auth/AuthLoading";
import { useSession, useAuthStatus, logout } from "@/lib/auth";
import { DEMO_ADMIN_CREDENTIALS } from "@/lib/demo-credentials";
import type { AdminUser } from "@/lib/types";

const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_CREDS === "true";

export default function AdminPage() {
  const session = useSession();
  const authStatus = useAuthStatus();
  const [forgotOpen, setForgotOpen] = useState(false);

  // Show the loading splash on the very first paint — the cookie may be
  // valid but /api/me hasn't resolved yet. Without this gate, the admin
  // login form flashes for ~200ms on every refresh even when the user is
  // signed in.
  if (authStatus === "loading") return <AuthLoading />;

  if (!session || session.role !== "admin") {
    if (forgotOpen) return <ForgotPasswordForm onBack={() => setForgotOpen(false)} />;
    return (
      <LoginForm
        brandTitle="لوحة الإدارة — مختبرك"
        brandSubtitle="تسجيل دخول الموظفين"
        allowedRoles={["admin"]}
        onSuccess={() => { /* useSession() in this page re-renders */ }}
        onForgotPassword={() => setForgotOpen(true)}
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
