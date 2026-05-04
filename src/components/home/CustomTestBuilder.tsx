"use client";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Plus, Check, X, ShoppingCart } from "lucide-react";
import { useTests, useCatalogStatus } from "@/lib/catalog";
import { searchTests, formatPrice } from "@/lib/utils";
import type { Test } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { BackButton } from "@/components/ui/BackButton";

interface CustomTestBuilderProps {
  onContinue: (tests: Test[]) => void;
  onBack: () => void;
}

export function CustomTestBuilder({ onContinue, onBack }: CustomTestBuilderProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Test[]>([]);
  const tests = useTests();
  const catalogStatus = useCatalogStatus();

  const results = useMemo(() => searchTests(tests, query), [tests, query]);

  const toggle = (test: Test) => {
    setSelected((prev) =>
      prev.find((t) => t.id === test.id) ? prev.filter((t) => t.id !== test.id) : [...prev, test]
    );
  };

  const total = selected.reduce((s, t) => s + t.sellPrice, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-4 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3 mb-4">
          <BackButton onClick={onBack} />
          <h1 className="text-[16px] font-bold text-[#164E63]">اختر تحاليلك</h1>
        </div>
        {/* Search */}
        <div className="relative">
          <Search size={17} className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالعربية أو الإنجليزية أو الاختصار..."
            aria-label="البحث عن تحاليل"
            className="w-full h-11 pe-10 ps-4 rounded-xl border border-gray-200 bg-gray-50 text-sm text-[#164E63] placeholder:text-gray-400 focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/15 focus:outline-none transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute start-3 top-1/2 -translate-y-1/2 cursor-pointer"
              aria-label="مسح البحث"
            >
              <X size={15} className="text-gray-400" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Selected chips */}
      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden bg-[#ECFEFF] border-b border-[#A5F3FC]/40"
          >
            <div
              className="flex gap-2 px-4 py-3 overflow-x-auto"
              role="list"
              aria-label="التحاليل المختارة"
              style={{ scrollbarWidth: "none" }}
            >
              {selected.map((t) => (
                <motion.div
                  key={t.id}
                  role="listitem"
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.85, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-full border border-[#0891B2]/25 flex-shrink-0"
                >
                  <span className="text-xs font-semibold text-[#0891B2]">{t.nameAr}</span>
                  <button
                    onClick={() => toggle(t)}
                    aria-label={`إزالة ${t.nameAr}`}
                    className="cursor-pointer"
                  >
                    <X size={12} className="text-gray-400" aria-hidden="true" />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <div className="flex-1 overflow-y-auto pb-28 bg-white" role="list" aria-label="نتائج البحث">
        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6" role="status">
            <Search size={36} className="text-gray-200 mb-3" aria-hidden="true" />
            {catalogStatus === "ready" && tests.length === 0 ? (
              <>
                <p className="text-sm text-gray-500 font-semibold">لم تُضف تحاليل بعد</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">على المسؤول إضافة التحاليل من لوحة الإدارة لتظهر هنا.</p>
              </>
            ) : catalogStatus === "loading" || catalogStatus === "idle" ? (
              <p className="text-sm text-gray-400">جاري تحميل التحاليل…</p>
            ) : (
              <>
                <p className="text-sm text-gray-400">لا توجد نتائج لـ &ldquo;{query}&rdquo;</p>
                <p className="text-xs text-gray-300 mt-1">جرّب الإنجليزية أو الاختصار</p>
              </>
            )}
          </div>
        ) : (
          <>
            {!query && (
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <span className="text-xs text-gray-400 font-semibold">جميع التحاليل</span>
              </div>
            )}
            {results.map((test, i) => (
              <TestRow
                key={test.id}
                role="listitem"
                test={test}
                index={i}
                isSelected={!!selected.find((t) => t.id === test.id)}
                onToggle={() => toggle(test)}
              />
            ))}
          </>
        )}
      </div>

      {/* Sticky cart bar */}
      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="fixed bottom-0 start-0 end-0 z-30 bg-white border-t border-gray-100 px-4 pt-3 safe-bottom-md shadow-[0_-8px_24px_rgba(0,0,0,0.06)]"
            style={{ maxWidth: "448px", margin: "0 auto" }}
            role="status"
            aria-live="polite"
            aria-label={`${selected.length} تحليل مختار — الإجمالي ${formatPrice(total)}`}
          >
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <ShoppingCart size={16} className="text-[#0891B2]" aria-hidden="true" />
                  <span className="text-sm font-bold text-[#164E63]">{selected.length} تحليل</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 ms-6">
                  الإجمالي: <span className="font-bold text-[#164E63]">{formatPrice(total)}</span>
                </p>
              </div>
              <Button onClick={() => onContinue(selected)} size="md" className="px-6">
                متابعة
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TestRow({
  test, index, isSelected, onToggle, role,
}: {
  test: Test; index: number; isSelected: boolean; onToggle: () => void; role?: string;
}) {
  // Make the entire row tap-target the toggle. Circle on the start side
  // morphs from "+" → check on selection. Soft cyan tint highlights the
  // selected state without competing with the row text.
  return (
    <motion.button
      type="button"
      role={role}
      onClick={onToggle}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.2) }}
      whileTap={{ scale: 0.985 }}
      aria-pressed={isSelected}
      aria-label={isSelected ? `إزالة ${test.nameAr}` : `إضافة ${test.nameAr}`}
      className={`w-full flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 cursor-pointer text-start transition-colors ${
        isSelected
          ? "bg-[#ECFEFF]/70 ring-1 ring-inset ring-[#0891B2]/20"
          : "bg-white hover:bg-gray-50/60"
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-200 ${
          isSelected
            ? "bg-[#059669] text-white shadow-[0_2px_8px_rgba(5,150,105,0.28)]"
            : "bg-gray-100 text-gray-500"
        }`}
      >
        {isSelected ? <Check size={16} strokeWidth={3} /> : <Plus size={16} />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#164E63] truncate">{test.nameAr}</p>
        <p className="text-[11px] text-gray-400 mt-0.5 lat" dir="ltr">{test.nameEn} · {test.shortName}</p>
      </div>
      <p className="text-sm font-bold text-[#164E63] flex-shrink-0">{formatPrice(test.sellPrice)}</p>
    </motion.button>
  );
}
