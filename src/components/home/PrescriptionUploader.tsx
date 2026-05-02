"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Camera, AlertTriangle, Check } from "lucide-react";
import { useTests } from "@/lib/catalog";
import { formatPrice } from "@/lib/utils";
import type { Test, PrescriptionMatch } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { BackButton } from "@/components/ui/BackButton";

interface PrescriptionUploaderProps {
  onContinue: (tests: Test[]) => void;
  onBack: () => void;
}

export function PrescriptionUploader({ onContinue, onBack }: PrescriptionUploaderProps) {
  const tests = useTests();
  const [step, setStep] = useState<"upload" | "processing" | "results">("upload");
  const [matches, setMatches] = useState<PrescriptionMatch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleUpload = async () => {
    setStep("processing");
    await new Promise((r) => setTimeout(r, 2200));
    const extracted: PrescriptionMatch[] = [
      { id: "pm-1", rawText: "CBC", matchedTest: tests[0], confidence: 0.99, isUnclear: false },
      { id: "pm-2", rawText: "FBS", matchedTest: tests[1], confidence: 0.97, isUnclear: false },
      { id: "pm-3", rawText: "Vitamin D", matchedTest: tests[2], confidence: 0.95, isUnclear: false },
      { id: "pm-4", rawText: "XXXX-unclear", matchedTest: undefined, confidence: 0.2, isUnclear: true },
    ];
    setMatches(extracted);
    const defaultSelected = new Set(extracted.filter((m) => !m.isUnclear && m.matchedTest).map((m) => m.id));
    setSelected(defaultSelected);
    setStep("results");
  };

  const toggleMatch = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedTests = matches.filter((m) => selected.has(m.id) && m.matchedTest).map((m) => m.matchedTest!);
  const total = selectedTests.reduce((s, t) => s + t.sellPrice, 0);
  const hasUnclear = matches.some((m) => m.isUnclear);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-100 flex items-center gap-3 bg-white">
        <BackButton onClick={onBack} />
        <h1 className="text-[16px] font-bold text-[#164E63]">ارفع وصفة طبية</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {step === "upload" && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              className="px-4 py-8 space-y-5"
            >
              <p className="text-sm text-gray-500 leading-relaxed text-center">
                صوّر وصفتك الطبية وسنستخرج التحاليل المطلوبة تلقائياً
              </p>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleUpload}
                className="w-full border-2 border-dashed border-gray-200 rounded-2xl p-10 flex flex-col items-center gap-4 bg-gray-50 cursor-pointer active:bg-gray-100 transition-colors"
                aria-label="رفع صورة الوصفة"
              >
                <div className="w-14 h-14 bg-white rounded-xl flex items-center justify-center shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
                  <Upload size={24} className="text-[#0891B2]" aria-hidden="true" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-[#164E63]">اختر صورة</p>
                  <p className="text-xs text-gray-400 mt-0.5">PNG, JPG, PDF</p>
                </div>
              </motion.button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-xs text-gray-400 font-medium">أو</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleUpload}
                className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl bg-white border border-gray-200 cursor-pointer active:bg-gray-50 transition-colors"
                aria-label="التقاط صورة الوصفة"
              >
                <Camera size={19} className="text-gray-500" aria-hidden="true" />
                <span className="text-sm font-medium text-gray-600">التقاط صورة الآن</span>
              </motion.button>
            </motion.div>
          )}

          {step === "processing" && (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-4 py-8"
              role="status"
              aria-label="جارٍ تحليل الوصفة"
              aria-live="polite"
            >
              <div className="flex flex-col items-center py-8 gap-4">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                  className="w-12 h-12 border-3 border-gray-200 border-t-[#0891B2] rounded-full"
                  style={{ borderWidth: "3px" }}
                  aria-hidden="true"
                />
                <p className="text-base font-semibold text-[#164E63]">جارٍ تحليل الوصفة...</p>
                <p className="text-xs text-gray-400">يستغرق هذا بضع ثوانٍ</p>
              </div>
              <div className="space-y-2.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-100">
                    <Skeleton className="w-10 h-10 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {step === "results" && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              className="px-4 py-4 space-y-3 pb-28"
            >
              {hasUnclear && (
                <motion.div
                  initial={{ scale: 0.96, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex gap-3"
                  role="alert"
                >
                  <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm text-amber-800 leading-relaxed">
                    يوجد تحليل غير واضح في الوصفة، سيتم التواصل معك لتأكيد السعر.
                  </p>
                </motion.div>
              )}

              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">التحاليل المستخرجة</h3>

              {matches.map((match, i) => (
                <motion.div
                  key={match.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.2 }}
                  onClick={() => !match.isUnclear && match.matchedTest && toggleMatch(match.id)}
                  role={match.matchedTest ? "checkbox" : undefined}
                  aria-checked={match.matchedTest ? selected.has(match.id) : undefined}
                  tabIndex={match.matchedTest ? 0 : undefined}
                  className={`rounded-xl border p-4 transition-colors duration-150 ${
                    match.isUnclear
                      ? "border-amber-100 bg-amber-50"
                      : selected.has(match.id)
                      ? "border-[#0891B2]/30 bg-[#ECFEFF] cursor-pointer"
                      : "border-gray-100 bg-white cursor-pointer active:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                      match.isUnclear ? "bg-amber-200" : selected.has(match.id) ? "bg-[#059669]" : "bg-gray-100"
                    }`}>
                      {match.isUnclear
                        ? <AlertTriangle size={11} className="text-amber-700" aria-hidden="true" />
                        : selected.has(match.id)
                        ? <Check size={11} className="text-white" aria-hidden="true" />
                        : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      {match.matchedTest ? (
                        <>
                          <p className="text-sm font-semibold text-[#164E63]">{match.matchedTest.nameAr}</p>
                          <p className="text-xs text-gray-400">{match.matchedTest.nameEn} · {match.rawText}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-amber-800">تحليل غير محدد</p>
                          <p className="text-xs text-amber-600">&ldquo;{match.rawText}&rdquo; – يحتاج تأكيد</p>
                        </>
                      )}
                    </div>
                    {match.matchedTest && (
                      <p className="text-sm font-bold text-[#164E63] flex-shrink-0">{formatPrice(match.matchedTest.sellPrice)}</p>
                    )}
                  </div>
                </motion.div>
              ))}

              {selectedTests.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex justify-between">
                  <span className="text-sm text-gray-500">{selectedTests.length} تحليل</span>
                  <span className="text-sm font-bold text-[#164E63]">{formatPrice(total)}</span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {step === "results" && selectedTests.length > 0 && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="px-4 py-3 bg-white border-t border-gray-100 safe-bottom"
        >
          <Button onClick={() => onContinue(selectedTests)} size="lg" className="w-full">
            متابعة — {formatPrice(total)}
          </Button>
        </motion.div>
      )}
    </div>
  );
}
