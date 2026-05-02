"use client";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Shield, X, Phone } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  open: boolean;
  /** Optional contextual reason — e.g. "أكمل تسجيل الدخول لإتمام طلبك". */
  reasonAr?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const TEST_OTP = "1234";

/**
 * Compact login modal for guest customers. Phone → OTP → success.
 * Caller is responsible for replaying the original intent on success.
 */
export function LoginModal({ open, reasonAr, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const otpRefs = [
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
  ];

  // Reset is not auto-handled here: parent unmounts the modal on close (we
  // rely on AnimatePresence's exit + the absence in the tree), so reopening
  // re-creates fresh state. If the user closes mid-OTP, we keep their phone
  // for a friendlier reopen experience.

  const sendOtp = async () => {
    if (phone.replace(/\D/g, "").length < 9) {
      setError("يرجى إدخال رقم هاتف صحيح"); return;
    }
    setError(""); setLoading(true);
    await new Promise((r) => setTimeout(r, 700));
    setLoading(false);
    setStep("otp");
    setTimeout(() => otpRefs[0].current?.focus(), 50);
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    if (value && index < 3) otpRefs[index + 1].current?.focus();
  };

  const verify = async () => {
    const code = otp.join("");
    if (code.length < 4) { setError("الرمز ناقص"); return; }
    setError(""); setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    setLoading(false);
    if (code !== TEST_OTP) { setError("الرمز غير صحيح، حاول مرة أخرى"); return; }
    onSuccess();
  };

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
            // Bottom sheet on mobile (rounded top, drag-handle, hugs the
            // bottom). Centered card on md+ screens.
            className="relative w-full md:w-auto md:max-w-md bg-white rounded-t-3xl md:rounded-3xl overflow-hidden shadow-[0_-12px_40px_rgba(0,0,0,0.18)] md:shadow-[0_24px_48px_rgba(0,0,0,0.16)] safe-bottom"
          >
            {/* Drag handle (mobile bottom-sheet affordance) */}
            <div className="md:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-200" aria-hidden="true" />
            </div>

            {/* Hero header — centered on mobile, inline on desktop */}
            <header className="px-6 pt-3 md:pt-6 pb-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-[#ECFEFF] flex items-center justify-center">
                    <Shield size={18} className="text-[#0891B2]" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 id="login-modal-title" className="text-base font-bold text-[#164E63] leading-tight">
                      {step === "phone" ? "تسجيل الدخول" : "تأكيد رقم الهاتف"}
                    </h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {step === "phone" ? "أدخل رقم هاتفك للمتابعة" : "أدخل رمز التحقق"}
                    </p>
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

              {step === "phone" ? (
                <PhoneStep
                  phone={phone}
                  onPhoneChange={(v) => { setPhone(v); setError(""); }}
                  onSubmit={sendOtp}
                  loading={loading}
                  error={error}
                />
              ) : (
                <OtpStep
                  phone={phone}
                  otp={otp}
                  refs={otpRefs}
                  onChange={handleOtpChange}
                  onSubmit={verify}
                  onBack={() => { setStep("phone"); setError(""); }}
                  loading={loading}
                  error={error}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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

function OtpStep({ phone, otp, refs, onChange, onSubmit, onBack, loading, error }: {
  phone: string;
  otp: string[];
  refs: React.RefObject<HTMLInputElement | null>[];
  onChange: (i: number, v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  loading: boolean;
  error: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 text-center leading-relaxed">
        أدخل الرمز المرسل إلى <span className="lat font-semibold text-[#164E63]" dir="ltr">+963 {phone}</span>
        {" "}— استخدم <span className="lat font-bold text-[#0891B2]" dir="ltr">1234</span> في النسخة التجريبية.
      </p>
      <div className="flex justify-center gap-2 py-2" dir="ltr">
        {otp.map((d, i) => (
          <input
            key={i}
            ref={refs[i]}
            type="text" inputMode="numeric" maxLength={1}
            value={d}
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !otp[i] && i > 0) refs[i - 1].current?.focus();
              if (e.key === "Enter" && otp.every((x) => x)) onSubmit();
            }}
            className="w-12 h-12 rounded-xl border-2 border-gray-200 text-center text-xl font-bold text-[#164E63] focus:border-[#0891B2] focus:outline-none transition-colors lat"
            aria-label={`خانة ${i + 1}`}
          />
        ))}
      </div>
      {error && <p role="alert" className="text-xs text-red-600 text-center">{error}</p>}
      <Button variant="primary" size="lg" className="w-full" loading={loading} disabled={otp.some((x) => !x)} onClick={onSubmit}>
        تأكيد الدخول
      </Button>
      <button onClick={onBack} className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 cursor-pointer">
        <ChevronRight size={12} aria-hidden="true" />
        تغيير الرقم
      </button>
      <button className="w-full flex items-center justify-center gap-1 text-[11px] text-[#0891B2] cursor-pointer pt-1">
        <Phone size={11} aria-hidden="true" />
        إعادة إرسال الرمز
      </button>
    </div>
  );
}
