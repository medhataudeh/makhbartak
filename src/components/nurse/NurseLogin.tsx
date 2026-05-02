"use client";
import { LoginForm } from "@/components/auth/LoginForm";
import { MOCK_NURSE_USERS } from "@/lib/mock-data";

export function NurseLogin() {
  return (
    <LoginForm
      brandTitle="مختبرك — تطبيق الممرض"
      brandSubtitle="تسجيل دخول الممرضين"
      allowedRoles={["nurse"]}
      onSuccess={() => { /* useSession() in NurseApp will re-render */ }}
      demoCredentials={MOCK_NURSE_USERS.map((u) => ({
        label: u.name, username: u.username, password: u.password,
      }))}
    />
  );
}
