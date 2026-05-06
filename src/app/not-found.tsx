// Phase 5.1 — friendly Arabic 404 with a back-home button.
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-app px-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <p className="text-5xl font-bold text-[#0891B2] lat">404</p>
        <h1 className="text-lg font-bold text-[#164E63]">الصفحة غير موجودة</h1>
        <p className="text-sm text-gray-500">الرابط الذي تتبعه قد يكون قديماً أو لم يعد متاحاً.</p>
        <Link
          href="/"
          className="inline-block px-4 py-2 rounded-xl bg-[#0891B2] text-white text-sm font-semibold cursor-pointer"
        >
          العودة إلى الصفحة الرئيسية
        </Link>
      </div>
    </div>
  );
}
