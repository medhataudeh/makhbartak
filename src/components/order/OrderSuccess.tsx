"use client";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { Clock, Droplets, Pill, IdCard, Shirt, Share2, ClipboardList, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useOrders } from "@/lib/store";
import { instructionsForOrder, isStructuredInstructions } from "@/lib/order-utils";
import type { TestInstruction, Instruction } from "@/lib/types";

interface OrderSuccessProps {
  orderId: string;
  onViewOrder: () => void;
  onShare: () => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  clock: <Clock size={20} className="text-amber-600" aria-hidden="true" />,
  droplets: <Droplets size={20} className="text-blue-500" aria-hidden="true" />,
  pill: <Pill size={20} className="text-red-500" aria-hidden="true" />,
  "id-card": <IdCard size={20} className="text-[#0891B2]" aria-hidden="true" />,
  shirt: <Shirt size={20} className="text-gray-500" aria-hidden="true" />,
};

export function OrderSuccess({ orderId, onViewOrder, onShare }: OrderSuccessProps) {
  // Look up the just-created order by its public number so we can render the
  // aggregated, deduped instructions for its actual items. Falls back to an
  // empty list which the helper resolves to platform defaults.
  const orders = useOrders();
  const matched = orders.find((o) => o.publicNumber === orderId);
  const aggregated = matched
    ? instructionsForOrder(matched)
    : ([] as Instruction[] | TestInstruction[]);
  const aggregatedStructured = aggregated.length > 0 && isStructuredInstructions(aggregated);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([60, 40, 60]);
    }
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-white pb-cta" role="main" aria-label="تأكيد الطلب">
      {/* Success mark — restrained: single circle, no pulsing rings */}
      <div className="flex flex-col items-center pt-12 pb-6 px-6">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 16, stiffness: 200 }}
          className="mb-5"
        >
          <CheckCircle
            size={72}
            className="text-[#059669]"
            aria-hidden="true"
            style={{ filter: "drop-shadow(0 4px 12px rgba(5,150,105,0.22))" }}
          />
        </motion.div>

        <motion.h1
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.25 }}
          className="text-xl font-bold text-[#164E63] mb-1 text-center"
        >
          تم استلام طلبك، نحن معك خطوة بخطوة
        </motion.h1>
        <motion.p
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.25 }}
          className="text-sm text-gray-400 text-center"
        >
          رقم الطلب:{" "}
          <span className="font-bold text-[#0891B2] lat ltr-tech">{orderId}</span>
        </motion.p>
        <motion.p
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.22 }}
          className="text-xs text-gray-400 mt-1 text-center"
        >
          سنرسل لك إشعاراً فور تأكيد الموعد.
        </motion.p>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-gray-100 mb-5" />

      {/* Instructions */}
      <div className="flex-1 px-4 pb-6">
        <motion.h2
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="text-[15px] font-bold text-[#164E63] mb-4"
        >
          لنتأكد من دقة النتائج، إليك خطوات التحضير
        </motion.h2>

        <div className="space-y-2" role="list" aria-label="تعليمات التحضير">
          {aggregated.map((ins, i) => (
            <motion.div
              key={ins.id}
              role="listitem"
              initial={{ x: -12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.38 + i * 0.06, duration: 0.22, ease: "easeOut" }}
              className="flex items-start gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3.5"
            >
              <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0">
                {ICON_MAP[ins.icon] ?? <ClipboardList size={20} className="text-gray-400" aria-hidden="true" />}
              </div>
              <div className="pt-0.5">
                {aggregatedStructured ? (
                  <>
                    <p className="text-sm font-semibold text-[#164E63] leading-snug">{(ins as TestInstruction).titleAr}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{(ins as TestInstruction).bodyAr}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-[#164E63] leading-snug">{(ins as Instruction).textAr}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{(ins as Instruction).textEn}</p>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Actions — sticky on mobile so the CTAs stay reachable while the
         instructions list scrolls. On desktop the static layout is fine. */}
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.65, duration: 0.25 }}
        className="fixed md:static bottom-0 inset-x-0 px-4 pt-3 md:pt-6 bg-white border-t md:border-0 border-gray-100 space-y-2 md:space-y-3 safe-bottom-md md:pb-6 z-30"
      >
        <div className="max-w-md mx-auto space-y-2 md:space-y-3">
          <Button onClick={onShare} variant="outline" size="lg" className="w-full">
            <Share2 size={17} aria-hidden="true" />
            مشاركة التعليمات
          </Button>
          <Button onClick={onViewOrder} size="lg" className="w-full">
            <ClipboardList size={17} aria-hidden="true" />
            عرض الطلب
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
