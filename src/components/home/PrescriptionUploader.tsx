"use client";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { Upload, AlertTriangle, Check, FileText } from "lucide-react";
import { useTests } from "@/lib/catalog";
import { useSession } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";
import { formatPrice } from "@/lib/utils";
import type { Test } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { BackButton } from "@/components/ui/BackButton";

interface PrescriptionUploaderProps {
  // Phase 3.6: returns the selected tests AND the storage path of the
  // uploaded prescription so the booking flow can persist it on the order.
  onContinue: (input: { tests: Test[]; prescriptionPath: string }) => void;
  onBack: () => void;
}

interface MatchedRow {
  id: string;
  rawText: string;
  matchedTest: Test;
}

// Light heuristic — match each token against test alias arrays. Production
// will eventually replace this with a real OCR pass; the contract (extract
// tokens → resolve to Test rows from the live catalog) stays the same.
function buildMatchesFromCatalog(tests: Test[]): MatchedRow[] {
  // Show the first 3 active tests as suggestions until OCR ships. Tokens
  // are derived from the test name itself so admins see real catalog items.
  return tests
    .filter((t) => t.isActive)
    .slice(0, 3)
    .map((t, idx) => ({
      id: `pm-${idx}-${t.id}`,
      rawText: t.shortName ?? t.nameEn ?? t.nameAr,
      matchedTest: t,
    }));
}

export function PrescriptionUploader({ onContinue, onBack }: PrescriptionUploaderProps) {
  const tests = useTests();
  const session = useSession();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "uploading" | "results">("upload");
  const [matches, setMatches] = useState<MatchedRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [storagePath, setStoragePath] = useState<string | null>(null);

  const customerId = session?.role === "customer" ? session.linkedEntityId : null;

  const handlePickFile = () => {
    if (!customerId) {
      toast.error("يجب تسجيل الدخول قبل رفع الوصفة");
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    if (!customerId) { toast.error("يجب تسجيل الدخول قبل رفع الوصفة"); return; }

    setStep("uploading");
    setPreviewName(file.name);
    if (file.type.startsWith("image/")) setPreviewUrl(URL.createObjectURL(file));
    else setPreviewUrl(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/prescriptions`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.path) {
        toast.error(body?.error ?? "تعذر رفع الوصفة، حاول مرة أخرى");
        setStep("upload");
        return;
      }
      setStoragePath(body.path as string);
      const initialMatches = buildMatchesFromCatalog(tests);
      setMatches(initialMatches);
      setSelected(new Set(initialMatches.map((m) => m.id)));
      setStep("results");
    } catch (err) {
      toast.error((err as Error).message);
      setStep("upload");
    }
  };

  const toggleMatch = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedTests = matches.filter((m) => selected.has(m.id)).map((m) => m.matchedTest);
  const total = selectedTests.reduce((s, t) => s + t.sellPrice, 0);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-4 border-b border-gray-100 flex items-center gap-3 bg-white">
        <BackButton onClick={onBack} />
        <h1 className="text-[16px] font-bold text-[#164E63]">ارفع وصفة طبية</h1>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

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
                صوّر وصفتك الطبية وسنحفظها على ملفك. سيتواصل معك فريق الدعم لتأكيد التحاليل.
              </p>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handlePickFile}
                className="w-full border-2 border-dashed border-gray-200 rounded-2xl p-10 flex flex-col items-center gap-4 bg-gray-50 cursor-pointer active:bg-gray-100 transition-colors"
                aria-label="رفع صورة الوصفة"
              >
                <div className="w-14 h-14 bg-white rounded-xl flex items-center justify-center shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
                  <Upload size={24} className="text-[#0891B2]" aria-hidden="true" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-[#164E63]">اختر صورة أو PDF</p>
                  <p className="text-xs text-gray-400 mt-0.5">حد أقصى 8MB</p>
                </div>
              </motion.button>
            </motion.div>
          )}

          {step === "uploading" && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-4 py-12 flex flex-col items-center gap-4"
              role="status"
              aria-label="جارٍ رفع الوصفة"
              aria-live="polite"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                className="w-12 h-12 border-3 border-gray-200 border-t-[#0891B2] rounded-full"
                style={{ borderWidth: "3px" }}
                aria-hidden="true"
              />
              <p className="text-base font-semibold text-[#164E63]">جارٍ رفع الوصفة…</p>
              <p className="text-xs text-gray-400">نخزّن صورتك بأمان في ملفك</p>
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
              {/* Stored prescription preview — proves to the customer that
                  their actual file landed and not a fake match. */}
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center gap-3">
                {previewUrl ? (
                  <div className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0">
                    <Image src={previewUrl} alt="" fill sizes="56px" className="object-cover" />
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                    <FileText size={24} className="text-emerald-700" aria-hidden="true" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-emerald-800">تم رفع الوصفة بنجاح</p>
                  <p className="text-[11px] text-emerald-700 truncate">{previewName}</p>
                </div>
                <Check size={18} className="text-emerald-700 flex-shrink-0" aria-hidden="true" />
              </div>

              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex gap-3">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  اختر أقرب التحاليل من الكتالوج. سيراجع فريق الدعم وصفتك ويعدّل الطلب عند الحاجة.
                </p>
              </div>

              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">اقتراحات من الكتالوج</h3>

              {matches.length === 0 && (
                <p className="text-xs text-gray-500 py-6 text-center">لا توجد تحاليل فعّالة في الكتالوج بعد.</p>
              )}

              {matches.map((match, i) => (
                <motion.div
                  key={match.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.2 }}
                  onClick={() => toggleMatch(match.id)}
                  role="checkbox"
                  aria-checked={selected.has(match.id)}
                  tabIndex={0}
                  className={`rounded-xl border p-4 transition-colors duration-150 cursor-pointer ${
                    selected.has(match.id) ? "border-[#0891B2]/30 bg-[#ECFEFF]" : "border-gray-100 bg-white active:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                      selected.has(match.id) ? "bg-[#059669]" : "bg-gray-100"
                    }`}>
                      {selected.has(match.id) && <Check size={11} className="text-white" aria-hidden="true" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#164E63]">{match.matchedTest.nameAr}</p>
                      <p className="text-xs text-gray-400">{match.matchedTest.nameEn ?? "—"} · {match.rawText}</p>
                    </div>
                    <p className="text-sm font-bold text-[#164E63] flex-shrink-0">{formatPrice(match.matchedTest.sellPrice)}</p>
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

      {step === "results" && storagePath && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="px-4 pt-3 bg-white border-t border-gray-100 safe-bottom-md"
        >
          <Button
            onClick={() => onContinue({ tests: selectedTests, prescriptionPath: storagePath })}
            size="lg"
            className="w-full"
            disabled={selectedTests.length === 0}
          >
            متابعة {selectedTests.length > 0 ? `— ${formatPrice(total)}` : ""}
          </Button>
        </motion.div>
      )}
    </div>
  );
}
