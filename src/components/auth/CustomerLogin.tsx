"use client";
import { LoginForm } from "@/components/auth/LoginForm";
import { MOCK_CUSTOMER_USERS } from "@/lib/mock-data";

export function CustomerLogin() {
  return (
    <LoginForm
      brandTitle="مختبرك"
      brandSubtitle="تسجيل دخول العملاء"
      allowedRoles={["customer"]}
      onSuccess={() => { /* useSession() in App will re-render naturally */ }}
      demoCredentials={MOCK_CUSTOMER_USERS.map((u) => ({
        label: u.name, username: u.username, password: u.password,
      }))}
    />
  );
}
