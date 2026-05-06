"use client";
// Phase 5.1 — root-level Next.js error boundary. Renders a friendly Arabic
// fallback instead of leaving the user staring at a blank tree. Stack
// traces never reach the customer; the digest is logged so support can
// correlate with server-side telemetry.
import { useEffect } from "react";
import Link from "next/link";
import { logger } from "@/lib/logger";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logger.error("client render error", {
      route: "client/root",
      digest: error.digest ?? null,
      // We deliberately do NOT include error.message at this layer because
      // it's already shown to the user. Server-side logger reads the same
      // digest from Next's runtime telemetry.
    });
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-app px-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-rose-50 flex items-center justify-center">
          <span className="text-2xl">!</span>
        </div>
        <h1 className="text-lg font-bold text-[#164E63]">حدث خطأ غير متوقع</h1>
        <p className="text-sm text-gray-500">
          تعذّر تحميل هذه الصفحة. حاول مرة أخرى أو ارجع للصفحة الرئيسية.
        </p>
        {error.digest && (
          <p className="text-[11px] text-gray-400 lat" dir="ltr">رمز الخطأ: {error.digest}</p>
        )}
        <div className="flex gap-2 justify-center pt-2">
          <button
            onClick={() => reset()}
            className="px-4 py-2 rounded-xl bg-[#0891B2] text-white text-sm font-semibold cursor-pointer active:bg-cyan-700"
          >
            إعادة المحاولة
          </button>
          <Link
            href="/"
            className="px-4 py-2 rounded-xl bg-gray-100 text-[#164E63] text-sm font-semibold cursor-pointer active:bg-gray-200"
          >
            الصفحة الرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}
