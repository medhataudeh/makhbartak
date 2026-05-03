"use client";
import { useState } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { DEMO_NURSE_CREDENTIALS } from "@/lib/demo-credentials";

const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_CREDS === "true";

export function NurseLogin() {
  const [forgot, setForgot] = useState(false);
  if (forgot) return <ForgotPasswordForm onBack={() => setForgot(false)} />;
  return (
    <LoginForm
      brandTitle="مختبرك — تطبيق الممرض"
      brandSubtitle="تسجيل دخول الممرضين"
      allowedRoles={["nurse"]}
      onSuccess={() => { /* useSession() in NurseApp will re-render */ }}
      onForgotPassword={() => setForgot(true)}
      demoCredentials={SHOW_DEMO ? DEMO_NURSE_CREDENTIALS.map((c) => ({
        label: c.label, username: c.email, password: c.password,
      })) : undefined}
    />
  );
}
