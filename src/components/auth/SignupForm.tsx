"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, Mail, Eye, EyeOff, FlaskConical, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { signupCustomer } from "@/lib/auth";

interface Props {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupForm({ onSuccess, onSwitchToLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!EMAIL_RE.test(email.trim())) { setError("البريد الإلكتروني غير صالح"); return; }
    if (password.length < 8) { setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل"); return; }
    setLoading(true);
    // Self-signup is email + password only; name/phone are collected later.
    const result = await signupCustomer({ email: email.trim(), password });
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "تعذر إنشاء الحساب");
      return;
    }
    onSuccess();
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
            <h1 className="text-lg font-bold text-[#164E63]">إنشاء حساب جديد</h1>
            <p className="text-xs text-gray-500">انضم إلى مختبرك خلال أقل من دقيقة</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field id="signup-email" label="البريد الإلكتروني" icon={<Mail size={16} />}>
            <input id="signup-email" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 ps-10 pe-3 rounded-xl border border-gray-200 text-sm text-[#164E63] focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/15 outline-none"
              style={{ direction: "ltr", textAlign: "right" }}
              required
            />
          </Field>

          <Field id="signup-password" label="كلمة المرور" icon={<Lock size={16} />}>
            <input id="signup-password"
              type={showPassword ? "text" : "password"} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 ps-10 pe-10 rounded-xl border border-gray-200 text-sm text-[#164E63] focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/15 outline-none"
              placeholder="8 أحرف على الأقل"
              style={{ direction: "ltr", textAlign: "right" }}
              required
            />
            <button type="button" onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
              className="absolute top-1/2 -translate-y-1/2 end-2 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </Field>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert"
              className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5"
            >
              <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-red-700">{error}</p>
            </motion.div>
          )}

          <Button type="submit" loading={loading} size="lg" className="w-full">
            إنشاء الحساب
          </Button>
        </form>

        <div className="mt-5 text-center text-xs text-gray-500">
          لديك حساب؟{" "}
          <button type="button" onClick={onSwitchToLogin}
            className="text-[#0E7490] font-semibold cursor-pointer hover:underline"
          >
            تسجيل الدخول
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function Field({ id, label, icon, children }: { id: string; label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-gray-500 mb-1.5 block">{label}</label>
      <div className="relative">
        <span className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true">{icon}</span>
        {children}
      </div>
    </div>
  );
}
