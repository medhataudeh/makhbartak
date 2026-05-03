"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Lock, Eye, EyeOff, FlaskConical, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { applyNewPassword, logout } from "@/lib/auth";
import { getSupabaseBrowser } from "@/lib/supabase/client";

// Landing page for the password-recovery email. Supabase appends an access
// token to the URL hash; @supabase/ssr's createBrowserClient picks it up
// automatically and exchanges it for a recovery session. Once that session
// exists, updateUser({ password }) sets the new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const init = async () => {
      const sb = getSupabaseBrowser();
      if (!sb) {
        if (!cancelled) {
          setRecoveryError("Supabase client not configured");
          setReady(true);
        }
        return;
      }
      // Listen for the PASSWORD_RECOVERY event in case the session lands later.
      const { data: sub } = sb.auth.onAuthStateChange((event) => {
        if (cancelled) return;
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
          setRecoveryError(null);
          setReady(true);
        }
      });
      unsubscribe = () => sub.subscription.unsubscribe();
      // Wait for the recovery session to be picked up from the URL hash.
      const { data } = await sb.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        setRecoveryError("الرابط منتهي الصلاحية أو غير صالح. اطلب رابطاً جديداً.");
      }
      setReady(true);
    };
    void init();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل"); return; }
    if (password !== confirm) { setError("كلمتا المرور غير متطابقتين"); return; }
    setLoading(true);
    const result = await applyNewPassword(password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "تعذر تحديث كلمة المرور");
      return;
    }
    setDone(true);
    // Sign the recovery session out so the user has to log in fresh with the
    // new password. Redirect after a short pause so the success state is visible.
    setTimeout(async () => {
      await logout();
      router.push("/");
    }, 1800);
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
            <h1 className="text-lg font-bold text-[#164E63]">تعيين كلمة مرور جديدة</h1>
            <p className="text-xs text-gray-500">اختر كلمة مرور قوية تتذكرها</p>
          </div>
        </div>

        {!ready ? (
          <p className="text-sm text-gray-500">جارِ تحميل الجلسة…</p>
        ) : recoveryError ? (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-3">
            <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm text-red-700 leading-relaxed">
              <p className="font-semibold mb-1">لا يمكن إعادة تعيين كلمة المرور</p>
              <p className="text-xs">{recoveryError}</p>
              <button onClick={() => router.push("/")}
                className="mt-3 text-[#0E7490] font-semibold cursor-pointer hover:underline text-xs"
              >
                العودة لتسجيل الدخول
              </button>
            </div>
          </div>
        ) : done ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-3"
          >
            <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm text-emerald-800 leading-relaxed">
              <p className="font-semibold mb-1">تم تحديث كلمة المرور</p>
              <p className="text-xs">سيتم تحويلك إلى صفحة تسجيل الدخول…</p>
            </div>
          </motion.div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <PasswordField id="reset-password" label="كلمة المرور الجديدة" value={password}
              onChange={setPassword} show={showPassword} onToggleShow={() => setShowPassword((s) => !s)}
            />
            <PasswordField id="reset-confirm" label="تأكيد كلمة المرور" value={confirm}
              onChange={setConfirm} show={showPassword} onToggleShow={() => setShowPassword((s) => !s)}
              hideToggle
            />

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
              حفظ كلمة المرور
            </Button>
          </form>
        )}
      </motion.div>
    </div>
  );
}

function PasswordField({ id, label, value, onChange, show, onToggleShow, hideToggle }: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; show: boolean; onToggleShow: () => void;
  hideToggle?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-gray-500 mb-1.5 block">{label}</label>
      <div className="relative">
        <Lock size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
        <input id={id}
          type={show ? "text" : "password"} autoComplete="new-password"
          value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full h-11 ps-10 pe-10 rounded-xl border border-gray-200 text-sm text-[#164E63] focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/15 outline-none"
          style={{ direction: "ltr", textAlign: "right" }}
          required
        />
        {!hideToggle && (
          <button type="button" onClick={onToggleShow}
            aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            className="absolute top-1/2 -translate-y-1/2 end-2 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 cursor-pointer"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
