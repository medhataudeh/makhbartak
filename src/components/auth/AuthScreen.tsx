"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface AuthScreenProps {
  onSuccess: () => void;
}

const slideVariants = {
  enter: { x: 24, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -24, opacity: 0 },
};

export function AuthScreen({ onSuccess }: AuthScreenProps) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendOtp = async () => {
    if (phone.replace(/\D/g, "").length < 9) {
      setError("يرجى إدخال رقم هاتف صحيح");
      return;
    }
    setError("");
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1200));
    setLoading(false);
    setStep("otp");
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    if (value && index < 3) {
      (document.getElementById(`otp-${index + 1}`) as HTMLInputElement)?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < 4) { setError("يرجى إدخال الرمز كاملاً"); return; }
    setError("");
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    if (code === "1234") onSuccess();
    else setError("الرمز غير صحيح، حاول مرة أخرى");
  };

  return (
    <div className="min-h-screen flex flex-col bg-app">
      {/* Wordmark header — clean, no gradient */}
      <div className="flex flex-col items-center pt-16 pb-10 px-6">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 20, stiffness: 200 }}
          className="w-20 h-20 bg-[#0891B2] rounded-2xl flex items-center justify-center mb-5"
          style={{ boxShadow: "0 4px 20px rgba(8,145,178,0.22)" }}
        >
          <span className="text-3xl font-bold text-white" aria-hidden="true">م</span>
        </motion.div>
        <motion.h1
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.25 }}
          className="text-xl font-bold text-[#164E63]"
        >
          مختبرك
        </motion.h1>
        <motion.p
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.25 }}
          className="text-sm text-gray-400 mt-1"
        >
          تحاليل طبية في بيتك
        </motion.p>
      </div>

      {/* Form area */}
      <div className="flex-1 px-6">
        <AnimatePresence mode="wait">
          {step === "phone" ? (
            <motion.div
              key="phone"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="space-y-5"
            >
              <div>
                <h2 className="text-[18px] font-bold text-[#164E63] mb-1">أدخل رقم هاتفك</h2>
                <p className="text-sm text-gray-400">سنرسل رمز تحقق مكوّن من 4 أرقام</p>
              </div>

              <div>
                <label htmlFor="phone-input" className="sr-only">رقم الهاتف</label>
                <div className="relative">
                  <div className="absolute end-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
                    <span className="text-xs text-gray-400 font-mono" dir="ltr">+963</span>
                    <div className="w-px h-4 bg-gray-200" />
                  </div>
                  <input
                    id="phone-input"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "")); setError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                    placeholder="9XXXXXXXX"
                    maxLength={10}
                    autoFocus
                    aria-describedby={error ? "phone-error" : undefined}
                    aria-invalid={!!error}
                    className="w-full h-14 pe-20 ps-4 rounded-xl border-2 border-gray-200 bg-white text-[#164E63] text-lg font-medium transition-colors focus:border-[#0891B2] focus:outline-none"
                    style={{ direction: "ltr", textAlign: "right" }}
                  />
                </div>
                {error && (
                  <motion.p
                    id="phone-error"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm text-red-500 mt-2"
                    role="alert"
                  >
                    {error}
                  </motion.p>
                )}
              </div>

              <Button onClick={handleSendOtp} loading={loading} size="lg" className="w-full">
                إرسال الرمز
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="otp"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="space-y-6"
            >
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={() => { setStep("phone"); setOtp(["", "", "", ""]); setError(""); }}
                  className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center cursor-pointer"
                  aria-label="العودة لإدخال رقم الهاتف"
                >
                  <ChevronRight size={18} className="text-[#164E63]" aria-hidden="true" />
                </button>
                <div>
                  <h2 className="text-[18px] font-bold text-[#164E63] leading-tight">رمز التحقق</h2>
                  <p className="text-xs text-gray-400 mt-0.5" dir="ltr">+963 {phone}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-[#ECFEFF] rounded-xl px-4 py-3">
                <Shield size={16} className="text-[#0891B2] flex-shrink-0" aria-hidden="true" />
                <p className="text-xs text-[#0E7490]">أرسلنا رمزاً مكوّناً من 4 أرقام</p>
              </div>

              {/* OTP boxes */}
              <div
                role="group"
                aria-label="أدخل رمز التحقق المكوّن من 4 أرقام"
                className="flex gap-3 justify-center"
                style={{ direction: "ltr" }}
              >
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    id={`otp-${i}`}
                    type="tel"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    aria-label={`الرقم ${i + 1}`}
                    aria-invalid={!!error}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !digit && i > 0)
                        (document.getElementById(`otp-${i - 1}`) as HTMLInputElement)?.focus();
                      if (e.key === "Enter") handleVerify();
                    }}
                    className="w-14 h-14 rounded-xl border-2 border-gray-200 text-center text-2xl font-bold text-[#164E63] transition-colors focus:border-[#0891B2] focus:outline-none"
                    style={{ caretColor: "transparent" }}
                  />
                ))}
              </div>

              <p className="text-xs text-center text-gray-400">
                رمز التجربة: <span className="font-mono font-semibold text-[#164E63]">1234</span>
              </p>

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-red-500 text-center"
                  role="alert"
                >
                  {error}
                </motion.p>
              )}

              <Button onClick={handleVerify} loading={loading} size="lg" className="w-full">
                تحقق
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className="text-xs text-center text-gray-300 px-6 py-6 safe-bottom">
        بالمتابعة توافق على سياسة الخصوصية وشروط الاستخدام
      </p>
    </div>
  );
}
