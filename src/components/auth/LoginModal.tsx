"use client";
import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Shield, X, Phone, Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { USE_SUPABASE, supabaseEnvReady, USE_DEV_OTP, DEV_OTP_CODE } from "@/lib/supabase/flags";
import {
  sendCustomerOtp, verifyCustomerOtp,
  sendEmailMagicLink, verifyEmailOtp,
  signInWithEmailPassword, signUpWithEmailPassword, resetPassword,
} from "@/lib/supabase/auth";

interface Props {
  open: boolean;
  /** Optional contextual reason — e.g. "أكمل تسجيل الدخول لإتمام طلبك". */
  reasonAr?: string;
  onClose: () => void;
  onSuccess: () => void;
}

type Channel = "phone" | "email";
type EmailMode = "password_login" | "password_signup" | "magic_link";

const LEGACY_TEST_OTP_4 = "1234";
const OTP_LEN = 6; // Supabase + dev fallback both use 6 digits.

/**
 * Compact login modal for guest customers. Phone or email → OTP → success.
 * Caller is responsible for replaying the original intent on success.
 */
export function LoginModal({ open, reasonAr, onClose, onSuccess }: Props) {
  const [channel, setChannel] = useState<Channel>("phone");
  const [emailMode, setEmailMode] = useState<EmailMode>("password_login");
  const [step, setStep] = useState<"identity" | "otp" | "info">("identity");
  const [info, setInfo] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LEN).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const otpRefs = useRef<Array<HTMLInputElement | null>>(Array(OTP_LEN).fill(null));

  const useRemote = USE_SUPABASE && supabaseEnvReady();
  const useDevFallback = USE_DEV_OTP;

  const switchChannel = (c: Channel) => {
    if (c === channel) return;
    setChannel(c);
    setStep("identity");
    setOtp(Array(OTP_LEN).fill(""));
    setError(""); setInfo("");
  };

  const switchEmailMode = (m: EmailMode) => {
    if (m === emailMode) return;
    setEmailMode(m);
    setStep("identity");
    setError(""); setInfo("");
    setOtp(Array(OTP_LEN).fill(""));
  };

  const showInfo = (msg: string) => { setInfo(msg); setStep("info"); };

  const isValidEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v);

  const submitIdentity = async () => {
    setError(""); setInfo("");
    setLoading(true);
    try {
      if (channel === "phone") {
        if (phone.replace(/\D/g, "").length < 9) {
          setError("يرجى إدخال رقم هاتف صحيح"); return;
        }
        if (useRemote) {
          const e164 = `+963${phone.replace(/\D/g, "")}`;
          const res = await sendCustomerOtp(e164);
          if (!res.ok) { setError(res.error?.message ?? "تعذر إرسال الرمز، حاول مرة أخرى"); return; }
        } else if (!useDevFallback) {
          await new Promise((r) => setTimeout(r, 700));
        } else {
          console.log("Using DEV OTP fallback");
        }
        setStep("otp");
        setTimeout(() => otpRefs.current[0]?.focus(), 50);
        return;
      }

      // Email channel
      if (!isValidEmail(email)) { setError("يرجى إدخال بريد إلكتروني صحيح"); return; }
      if (!useRemote) {
        setError("البريد الإلكتروني غير مفعّل في النسخة التجريبية"); return;
      }
      if (emailMode === "magic_link") {
        const res = await sendEmailMagicLink(email);
        if (!res.ok) { setError(res.error?.message ?? "تعذر إرسال الرابط"); return; }
        showInfo("أرسلنا لك رابطاً ورمزاً عبر البريد. اضغط الرابط أو ألصق الرمز هنا.");
        // Magic link also delivers a 6-digit code; let the user paste it.
        setStep("otp");
        setTimeout(() => otpRefs.current[0]?.focus(), 50);
        return;
      }
      if (emailMode === "password_login") {
        if (password.length < 6) { setError("كلمة المرور قصيرة جداً"); return; }
        const res = await signInWithEmailPassword(email, password);
        if (!res.ok) { setError(res.error?.message ?? "تعذر تسجيل الدخول"); return; }
        onSuccess();
        return;
      }
      if (emailMode === "password_signup") {
        if (password.length < 6) { setError("كلمة المرور قصيرة جداً"); return; }
        const res = await signUpWithEmailPassword(email, password);
        if (!res.ok) { setError(res.error?.message ?? "تعذر إنشاء الحساب"); return; }
        if (res.session) {
          onSuccess();
        } else {
          showInfo("أرسلنا لك رابط تأكيد على البريد. تحقق من صندوقك ثم سجّل الدخول.");
        }
        return;
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setError(""); setInfo("");
    if (!isValidEmail(email)) { setError("يرجى إدخال بريد إلكتروني صحيح"); return; }
    if (!useRemote) { setError("غير متاح في النسخة التجريبية"); return; }
    setLoading(true);
    const res = await resetPassword(email);
    setLoading(false);
    if (!res.ok) { setError(res.error?.message ?? "تعذر إرسال رابط إعادة التعيين"); return; }
    showInfo("أرسلنا رابط إعادة تعيين كلمة المرور إلى بريدك.");
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    if (value && index < OTP_LEN - 1) otpRefs.current[index + 1]?.focus();
  };

  const verify = async () => {
    const code = otp.join("");
    setError("");
    setLoading(true);
    try {
      if (channel === "phone") {
        if (useRemote) {
          const e164 = `+963${phone.replace(/\D/g, "")}`;
          const res = await verifyCustomerOtp(e164, code);
          if (!res.ok) { setError(res.error?.message ?? "الرمز غير صحيح، حاول مرة أخرى"); return; }
        } else if (useDevFallback) {
          if (code !== DEV_OTP_CODE) { setError("الرمز غير صحيح، حاول مرة أخرى"); return; }
        } else {
          await new Promise((r) => setTimeout(r, 600));
          const trimmed = code.replace(/0+$/, "");
          if (code !== DEV_OTP_CODE && trimmed !== LEGACY_TEST_OTP_4) {
            setError("الرمز غير صحيح، حاول مرة أخرى"); return;
          }
        }
      } else {
        if (!useRemote) { setError("البريد الإلكتروني غير مفعّل في النسخة التجريبية"); return; }
        const res = await verifyEmailOtp(email, code);
        if (!res.ok) { setError(res.error?.message ?? "الرمز غير صحيح، حاول مرة أخرى"); return; }
      }
      onSuccess();
    } finally {
      setLoading(false);
    }
  };

  const headerSubtitle = useMemo(() => {
    if (step === "otp") return "أدخل رمز التحقق";
    if (step === "info") return "تفقد بريدك";
    if (channel === "phone") return "أدخل رقم هاتفك للمتابعة";
    if (emailMode === "password_login") return "سجّل الدخول ببريدك وكلمة المرور";
    if (emailMode === "password_signup") return "أنشئ حساباً جديداً";
    return "أرسل رابطاً سحرياً إلى بريدك";
  }, [step, channel, emailMode]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog" aria-modal="true" aria-labelledby="login-modal-title"
          className="fixed inset-0 z-[80] flex items-end md:items-center justify-center"
        >
          <motion.button
            type="button" aria-label="إلغاء"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 cursor-pointer"
          />
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="relative w-full md:w-auto md:max-w-md bg-white rounded-t-3xl md:rounded-3xl overflow-hidden shadow-[0_-12px_40px_rgba(0,0,0,0.18)] md:shadow-[0_24px_48px_rgba(0,0,0,0.16)] safe-bottom"
          >
            <div className="md:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-200" aria-hidden="true" />
            </div>

            <header className="px-6 pt-3 md:pt-6 pb-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-[#ECFEFF] flex items-center justify-center">
                    <Shield size={18} className="text-[#0891B2]" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 id="login-modal-title" className="text-base font-bold text-[#164E63] leading-tight">
                      {step === "identity"
                        ? "تسجيل الدخول"
                        : channel === "phone" ? "تأكيد رقم الهاتف" : "تأكيد البريد الإلكتروني"}
                    </h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">{headerSubtitle}</p>
                  </div>
                </div>
                <button onClick={onClose} aria-label="إغلاق" className="w-9 h-9 rounded-xl hover:bg-gray-100 flex items-center justify-center cursor-pointer">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="px-6 pb-6 pt-3">
              {reasonAr && (
                <p className="text-xs text-gray-500 leading-relaxed mb-4 bg-[#ECFEFF]/60 border border-cyan-100 rounded-xl px-3 py-2.5">
                  {reasonAr}
                </p>
              )}

              {step === "identity" && (
                <ChannelToggle channel={channel} onChange={switchChannel} />
              )}

              {step === "identity" && channel === "email" && (
                <EmailModeToggle mode={emailMode} onChange={switchEmailMode} />
              )}

              {step === "info" && (
                <InfoScreen
                  message={info}
                  onBack={() => { setStep("identity"); setInfo(""); }}
                />
              )}

              {step === "identity" && channel === "phone" && (
                <PhoneStep
                  phone={phone}
                  onPhoneChange={(v) => { setPhone(v); setError(""); }}
                  onSubmit={submitIdentity}
                  loading={loading}
                  error={error}
                />
              )}

              {step === "identity" && channel === "email" && (
                <EmailStep
                  email={email}
                  password={password}
                  mode={emailMode}
                  onEmailChange={(v) => { setEmail(v); setError(""); }}
                  onPasswordChange={(v) => { setPassword(v); setError(""); }}
                  onSubmit={submitIdentity}
                  onForgotPassword={handleResetPassword}
                  loading={loading}
                  error={error}
                />
              )}

              {step === "otp" && (
                <OtpStep
                  channel={channel}
                  identity={channel === "phone" ? `+963 ${phone}` : email}
                  otp={otp}
                  refsRef={otpRefs}
                  onChange={handleOtpChange}
                  onSubmit={verify}
                  onBack={() => { setStep("identity"); setError(""); }}
                  loading={loading}
                  error={error}
                  showDevHint={channel === "phone" && (useDevFallback || !useRemote)}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ChannelToggle({ channel, onChange }: { channel: Channel; onChange: (c: Channel) => void }) {
  const tab = (key: Channel, label: string, Icon: typeof Phone) => {
    const active = channel === key;
    return (
      <button
        type="button"
        onClick={() => onChange(key)}
        aria-pressed={active}
        className={
          "flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl text-xs font-semibold transition-colors cursor-pointer " +
          (active
            ? "bg-[#0891B2] text-white"
            : "bg-gray-100 text-gray-500 hover:text-[#164E63]")
        }
      >
        <Icon size={14} aria-hidden="true" />
        {label}
      </button>
    );
  };
  return (
    <div className="flex gap-2 mb-4 p-1 bg-gray-50 rounded-2xl">
      {tab("phone", "رقم الهاتف", Phone)}
      {tab("email", "البريد الإلكتروني", Mail)}
    </div>
  );
}

function PhoneStep({ phone, onPhoneChange, onSubmit, loading, error }: {
  phone: string;
  onPhoneChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-[11px] font-medium text-gray-500">رقم الهاتف</span>
        <div className="relative mt-1">
          <span className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400 lat" dir="ltr">+963</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
            placeholder="9XXXXXXXX"
            className="w-full h-12 ps-16 pe-4 rounded-xl border-2 border-gray-200 bg-white text-[#164E63] text-base focus:border-[#0891B2] focus:outline-none transition-colors"
            inputMode="tel"
            autoFocus
          />
        </div>
      </label>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <Button variant="primary" size="lg" className="w-full" loading={loading} onClick={onSubmit}>
        إرسال رمز التحقق
      </Button>
      <p className="text-[11px] text-gray-400 text-center leading-relaxed">
        سنرسل رمزاً عبر رسالة قصيرة. يمكنك الاستمرار كزائر بإغلاق النافذة.
      </p>
    </div>
  );
}

function EmailModeToggle({ mode, onChange }: { mode: EmailMode; onChange: (m: EmailMode) => void }) {
  const item = (key: EmailMode, label: string) => {
    const active = mode === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        aria-pressed={active}
        className={
          "px-3 h-8 rounded-full text-[11px] font-semibold transition-colors cursor-pointer " +
          (active
            ? "bg-[#164E63] text-white"
            : "bg-white text-gray-500 border border-gray-200 hover:text-[#164E63]")
        }
      >
        {label}
      </button>
    );
  };
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {item("password_login", "تسجيل الدخول")}
      {item("password_signup", "إنشاء حساب")}
      {item("magic_link", "رابط سحري")}
    </div>
  );
}

function EmailStep({
  email, password, mode, onEmailChange, onPasswordChange,
  onSubmit, onForgotPassword, loading, error,
}: {
  email: string;
  password: string;
  mode: EmailMode;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: () => void;
  onForgotPassword: () => void;
  loading: boolean;
  error: string;
}) {
  const cta =
    mode === "password_login" ? "تسجيل الدخول" :
    mode === "password_signup" ? "إنشاء حساب" :
    "إرسال الرابط";
  const helper =
    mode === "magic_link"
      ? "سنرسل لك رابطاً ورمزاً عبر البريد. اضغط الرابط أو ألصق الرمز هنا."
      : mode === "password_signup"
      ? "ستصلك رسالة تأكيد على البريد بعد التسجيل."
      : "أدخل بريدك وكلمة المرور للمتابعة.";
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-[11px] font-medium text-gray-500">البريد الإلكتروني</span>
        <div className="relative mt-1">
          <Mail size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
          <input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
            placeholder="you@example.com"
            className="w-full h-12 ps-9 pe-4 rounded-xl border-2 border-gray-200 bg-white text-[#164E63] text-base focus:border-[#0891B2] focus:outline-none transition-colors lat"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            autoFocus
          />
        </div>
      </label>

      {mode !== "magic_link" && (
        <label className="block">
          <span className="text-[11px] font-medium text-gray-500">كلمة المرور</span>
          <div className="relative mt-1">
            <Lock size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
            <input
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
              placeholder="••••••••"
              className="w-full h-12 ps-9 pe-4 rounded-xl border-2 border-gray-200 bg-white text-[#164E63] text-base focus:border-[#0891B2] focus:outline-none transition-colors lat"
              autoComplete={mode === "password_login" ? "current-password" : "new-password"}
              dir="ltr"
            />
          </div>
        </label>
      )}

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <Button variant="primary" size="lg" className="w-full" loading={loading} onClick={onSubmit}>
        {cta}
      </Button>
      {mode === "password_login" && (
        <button
          type="button"
          onClick={onForgotPassword}
          className="w-full text-[11px] text-[#0891B2] cursor-pointer pt-1"
        >
          نسيت كلمة المرور؟
        </button>
      )}
      <p className="text-[11px] text-gray-400 text-center leading-relaxed">{helper}</p>
    </div>
  );
}

function InfoScreen({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="space-y-4 py-2">
      <div className="bg-[#ECFEFF]/60 border border-cyan-100 rounded-xl px-4 py-3 text-sm text-[#164E63] leading-relaxed">
        {message}
      </div>
      <Button variant="outline" size="md" className="w-full" onClick={onBack}>
        رجوع
      </Button>
    </div>
  );
}

function OtpStep({
  channel, identity, otp, refsRef, onChange, onSubmit, onBack,
  loading, error, showDevHint,
}: {
  channel: Channel;
  identity: string;
  otp: string[];
  refsRef: React.RefObject<Array<HTMLInputElement | null>>;
  onChange: (i: number, v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  loading: boolean;
  error: string;
  showDevHint: boolean;
}) {
  const allFilled = otp.every((x) => x);
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 text-center leading-relaxed">
        أدخل الرمز المرسل إلى <span className="lat font-semibold text-[#164E63]" dir="ltr">{identity}</span>
        {showDevHint && (
          <>{" "}— استخدم <span className="lat font-bold text-[#0891B2]" dir="ltr">{DEV_OTP_CODE}</span> في النسخة التجريبية.</>
        )}
      </p>
      <div className="flex justify-center gap-1.5 py-2" dir="ltr">
        {otp.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refsRef.current[i] = el; }}
            type="text" inputMode="numeric" maxLength={1}
            value={d}
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !otp[i] && i > 0) refsRef.current[i - 1]?.focus();
              if (e.key === "Enter" && allFilled) onSubmit();
            }}
            className="w-10 h-12 rounded-xl border-2 border-gray-200 text-center text-xl font-bold text-[#164E63] focus:border-[#0891B2] focus:outline-none transition-colors lat"
            aria-label={`خانة ${i + 1}`}
          />
        ))}
      </div>
      {error && <p role="alert" className="text-xs text-red-600 text-center">{error}</p>}
      <Button variant="primary" size="lg" className="w-full" loading={loading} disabled={!allFilled} onClick={onSubmit}>
        تأكيد الدخول
      </Button>
      <button onClick={onBack} className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 cursor-pointer">
        <ChevronRight size={12} aria-hidden="true" />
        {channel === "phone" ? "تغيير الرقم" : "تغيير البريد"}
      </button>
      <button className="w-full flex items-center justify-center gap-1 text-[11px] text-[#0891B2] cursor-pointer pt-1">
        {channel === "phone" ? <Phone size={11} aria-hidden="true" /> : <Mail size={11} aria-hidden="true" />}
        إعادة إرسال الرمز
      </button>
    </div>
  );
}
