"use client";
import { LoginForm } from "@/components/auth/LoginForm";
import { DEMO_CUSTOMER_CREDENTIALS } from "@/lib/demo-credentials";

const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_CREDS === "true";

export function CustomerLogin() {
  return (
    <LoginForm
      brandTitle="مختبرك"
      brandSubtitle="تسجيل دخول العملاء"
      allowedRoles={["customer"]}
      onSuccess={() => { /* useSession() in App will re-render naturally */ }}
      demoCredentials={SHOW_DEMO ? DEMO_CUSTOMER_CREDENTIALS.map((c) => ({
        label: c.label, username: c.email, password: c.password,
      })) : undefined}
    />
  );
}
