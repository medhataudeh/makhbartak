"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Lock, Shield, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { authErrorAr } from "@/lib/supabase/auth";

const MIN_LEN = 8;

type PageState = "loading" | "ready" | "invalid_link" | "submitting" | "success";

export default function ResetPasswordPage() {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<PageState>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  // Supabase parses the recovery hash automatically when the SDK loads in the
  // browser and emits a PASSWORD_RECOVERY event with a session attached. We
  // subscribe and also peek at the current session so a refresh on the same
  // tab still works.
  useEffect(() => {
    let resolved = false;
    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      setState(ok ? "ready" : "invalid_link");
    };

    const sb = getSupabaseBrowser();
    if (!sb) {
      // Defer to a microtask so we don't setState synchronously in the effect.
      const t0 = window.setTimeout(() => finish(false), 0);
      return () => window.clearTimeout(t0);
    }

    const { data: sub } = sb.auth.onAuthStateChange((evt, session) => {
      if (evt === "PASSWORD_RECOVERY" && session) finish(true);
      else if (evt === "SIGNED_IN" && session) finish(true);
    });

    sb.auth.getSession().then(({ data }) => {
      if (data.session) finish(true);
    });

    // If neither path resolves within a couple of seconds, the link is bad.
    const timer = window.setTimeout(() => finish(false), 2500);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < MIN_LEN) {
      setError(`كلمة المرور قصيرة جداً (${MIN_LEN} أحرف على الأقل)`);
      return;
    }
    if (password !== confirm) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }
    const sb = getSupabaseBrowser();
    if (!sb) { setError("الخدمة غير متاحة حالياً"); return; }
    setState("submitting");
    const { error: err } = await sb.auth.updateUser({ password });
    if (err) {
      console.error("Supabase updateUser error:", err);
      setError(authErrorAr(err.message));
      setState("ready");
      return;
    }
    setState("success");
    toast.success("تم تحديث كلمة المرور بنجاح");
    window.setTimeout(() => router.replace("/"), 2000);
  };

  return (
    <main className="min-h-screen bg-app flex items-center justify-center px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="w-full max-w-md bg-white rounded-2xl border border-gray-100 p-6 md:p-8"
      >
        <header className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-[#ECFEFF] flex items-center justify-center">
            <Shield size={20} className="text-[#0891B2]" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-bold text-[#164E63] leading-tight">
              تحديث كلمة المرور
            </h1>
            <p className="text-[11px] text-gray-400 mt-0.5">
              اختر كلمة مرور جديدة لحسابك
            </p>
          </div>
        </header>

        {state === "loading" && (
          <p className="text-xs text-gray-500 leading-relaxed text-center py-6">
            جاري التحقق من الرابط…
          </p>
        )}

        {state === "invalid_link" && (
          <div className="space-y-3">
            <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-red-700 leading-relaxed">
                الرابط غير صالح أو منتهي الصلاحية
              </p>
            </div>
            <Button variant="outline" size="md" className="w-full" onClick={() => router.replace("/")}>
              العودة للرئيسية
            </Button>
          </div>
        )}

        {state === "success" && (
          <div className="space-y-3">
            <div role="status" className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5">
              <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-emerald-700 leading-relaxed">
                تم تحديث كلمة المرور بنجاح. سيتم تحويلك خلال لحظات…
              </p>
            </div>
          </div>
        )}

        {(state === "ready" || state === "submitting") && (
          <form onSubmit={submit} className="space-y-3">
            <Input
              label="كلمة المرور الجديدة"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              autoComplete="new-password"
              dir="ltr"
              startIcon={<Lock size={14} aria-hidden="true" />}
              hint={`${MIN_LEN} أحرف على الأقل`}
            />
            <Input
              label="تأكيد كلمة المرور"
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(""); }}
              autoComplete="new-password"
              dir="ltr"
              startIcon={<Lock size={14} aria-hidden="true" />}
              error={error || undefined}
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              loading={state === "submitting"}
            >
              تحديث كلمة المرور
            </Button>
          </form>
        )}
      </motion.div>
    </main>
  );
}
