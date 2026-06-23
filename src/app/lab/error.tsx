"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { logger } from "@/lib/logger";

// Segment-level error boundary for the Lab Portal. Without this, any render
// throw inside LabPortal escalated to the global app/error.tsx and white-screened
// the whole app. Worse, the active section is persisted in sessionStorage
// (`makhbartak.lab.nav.v1`), so a crash on the Finance/Accounting tab was
// re-triggered on every refresh — the "trapped until clearing cache" symptom.
//
// On mount we (1) emit a PII-free structured diagnostic and (2) force the
// persisted section back to "orders" so BOTH a retry and a hard refresh reopen
// on the Orders list (never the role-default, which could be the crashing
// Accounting tab). The selected-order/detail state is component-local
// (not persisted), so the remount on retry already clears it.

const LAB_NAV_KEY = "makhbartak.lab.nav.v1";

export default function LabError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    let section: string | null = null;
    try { section = window.sessionStorage.getItem(LAB_NAV_KEY); } catch {}
    // Structured, PII-free: route + section + error name only. No message/stack
    // (could echo data), no patient/order/finance fields.
    logger.error("lab portal crashed", {
      route: "/lab",
      section: section ?? "unknown",
      errorName: error?.name ?? "Error",
    });
    // Break the refresh trap: pin the next render to a known-safe section.
    try { window.sessionStorage.setItem(LAB_NAV_KEY, "orders"); } catch {}
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-app p-4" dir="rtl">
      <div className="max-w-sm w-full bg-white rounded-2xl border border-gray-100 p-6 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto">
          <AlertTriangle size={22} className="text-amber-500" aria-hidden="true" />
        </div>
        <p className="text-sm font-bold text-[#164E63]">تعذّر تحميل هذه الصفحة</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          حدث خطأ غير متوقع في بوابة المختبر. يمكنك إعادة المحاولة أو العودة إلى قائمة الطلبات.
        </p>
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="w-full h-11 rounded-xl bg-[#0891B2] text-white text-sm font-semibold cursor-pointer active:bg-[#0E7490]"
          >
            العودة إلى الطلبات
          </button>
          <button
            type="button"
            onClick={() => { window.location.href = "/"; }}
            className="w-full h-11 rounded-xl border border-gray-200 text-[#164E63] text-sm font-semibold cursor-pointer active:bg-gray-50"
          >
            الصفحة الرئيسية
          </button>
        </div>
      </div>
    </div>
  );
}
