"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, User, Eye, EyeOff, FlaskConical, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { loginUser } from "@/lib/auth";
import type { AuthSession, Role } from "@/lib/types";

interface DemoCredential {
  label: string;
  username: string;
  password: string;
}

interface Props {
  brandTitle: string;
  brandSubtitle?: string;
  /** Restrict accepted role; mismatched role is treated as invalid credentials. */
  allowedRoles?: Role[];
  onSuccess: (session: AuthSession) => void;
  /** Demo creds shown under a collapsible (prototype only). */
  demoCredentials?: DemoCredential[];
}

export function LoginForm({
  brandTitle, brandSubtitle, allowedRoles, onSuccess, demoCredentials,
}: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("الرجاء إدخال البريد الإلكتروني وكلمة المرور");
      return;
    }
    setLoading(true);
    const result = await loginUser(username, password, { allowedRoles });
    setLoading(false);
    if (!result.ok || !result.session) {
      setError(result.error ?? "اسم المستخدم أو كلمة المرور غير صحيحة");
      return;
    }
    onSuccess(result.session);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-full max-w-md bg-white rounded-2xl border border-gray-100 p-6 md:p-8"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#ECFEFF] flex items-center justify-center">
            <FlaskConical size={22} className="text-[#0891B2]" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#164E63]">{brandTitle}</h1>
            {brandSubtitle && <p className="text-xs text-gray-500">{brandSubtitle}</p>}
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="login-username" className="text-xs font-medium text-gray-500 mb-1.5 block">
              البريد الإلكتروني
            </label>
            <div className="relative">
              <User
                size={16}
                className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400"
                aria-hidden="true"
              />
              <input
                id="login-username"
                type="email"
                autoComplete="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-11 ps-10 pe-3 rounded-xl border border-gray-200 text-sm text-[#164E63] placeholder:text-gray-400 focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/15 outline-none transition-all"
                style={{ direction: "ltr", textAlign: "right" }}
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="text-xs font-medium text-gray-500 mb-1.5 block">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock
                size={16}
                className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400"
                aria-hidden="true"
              />
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 ps-10 pe-10 rounded-xl border border-gray-200 text-sm text-[#164E63] placeholder:text-gray-400 focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/15 outline-none transition-all"
                placeholder="••••••••"
                style={{ direction: "ltr", textAlign: "right" }}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                className="absolute top-1/2 -translate-y-1/2 end-2 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5"
            >
              <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-red-700">{error}</p>
            </motion.div>
          )}

          <Button type="submit" loading={loading} size="lg" className="w-full">
            تسجيل الدخول
          </Button>
        </form>

        {demoCredentials && demoCredentials.length > 0 && (
          <details className="mt-6 text-xs text-gray-500">
            <summary className="cursor-pointer font-semibold text-[#0E7490]">حسابات تجريبية</summary>
            <ul className="mt-2 space-y-1 leading-relaxed">
              {demoCredentials.map((c) => (
                <li key={c.username} className="flex items-center justify-between border-b border-gray-50 py-1">
                  <span className="text-[#164E63] font-medium">{c.label}</span>
                  <span className="lat" dir="ltr">{c.username} / {c.password}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </motion.div>
    </div>
  );
}
