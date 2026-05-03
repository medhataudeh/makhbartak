"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, FlaskConical, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { requestPasswordReset } from "@/lib/auth";

interface Props {
  onBack: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordForm({ onBack }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!EMAIL_RE.test(email.trim())) {
      setError("الرجاء إدخال بريد إلكتروني صحيح");
      return;
    }
    setLoading(true);
    const result = await requestPasswordReset(email.trim());
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "تعذر إرسال رابط إعادة التعيين");
      return;
    }
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-full max-w-md bg-white rounded-2xl border border-gray-100 p-6 md:p-8"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#ECFEFF] flex items-center justify-center">
            <FlaskConical size={22} className="text-[#0891B2]" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#164E63]">استعادة كلمة المرور</h1>
            <p className="text-xs text-gray-500">سنرسل لك رابطاً عبر البريد الإلكتروني</p>
          </div>
        </div>

        {sent ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-3"
          >
            <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm text-emerald-800 leading-relaxed">
              <p className="font-semibold mb-1">تم إرسال الرابط</p>
              <p className="text-xs">
                إذا كان البريد الإلكتروني مسجلاً، ستجد رسالة باسم &ldquo;Reset your password&rdquo; خلال دقائق.
                افتح الرابط لاستكمال التغيير.
              </p>
            </div>
          </motion.div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="forgot-email" className="text-xs font-medium text-gray-500 mb-1.5 block">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <Mail size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
                <input id="forgot-email" type="email" autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 ps-10 pe-3 rounded-xl border border-gray-200 text-sm text-[#164E63] focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/15 outline-none"
                  style={{ direction: "ltr", textAlign: "right" }}
                  required
                />
              </div>
            </div>

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
              إرسال رابط إعادة التعيين
            </Button>
          </form>
        )}

        <div className="mt-5 text-center text-xs text-gray-500">
          <button type="button" onClick={onBack}
            className="text-[#0E7490] font-semibold cursor-pointer hover:underline"
          >
            العودة لتسجيل الدخول
          </button>
        </div>
      </motion.div>
    </div>
  );
}
