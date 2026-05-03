"use client";
import { useState } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { SignupForm } from "@/components/auth/SignupForm";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { DEMO_CUSTOMER_CREDENTIALS } from "@/lib/demo-credentials";

const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_CREDS === "true";

type View = "login" | "signup" | "forgot";

export function CustomerLogin() {
  const [view, setView] = useState<View>("login");

  if (view === "signup") {
    return (
      <SignupForm
        onSuccess={() => { /* useSession() in App will re-render naturally */ }}
        onSwitchToLogin={() => setView("login")}
      />
    );
  }
  if (view === "forgot") {
    return <ForgotPasswordForm onBack={() => setView("login")} />;
  }
  return (
    <LoginForm
      brandTitle="مختبرك"
      brandSubtitle="تسجيل دخول العملاء"
      allowedRoles={["customer"]}
      onSuccess={() => { /* useSession() in App will re-render naturally */ }}
      onSignup={() => setView("signup")}
      onForgotPassword={() => setView("forgot")}
      demoCredentials={SHOW_DEMO ? DEMO_CUSTOMER_CREDENTIALS.map((c) => ({
        label: c.label, username: c.email, password: c.password,
      })) : undefined}
    />
  );
}
