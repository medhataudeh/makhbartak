"use client";
import { motion } from "framer-motion";
import Image from "next/image";
import { FlaskConical, Check, ShoppingCart } from "lucide-react";
import type { Package } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { BackButton } from "@/components/ui/BackButton";

interface Props {
  pkg: Package;
  onAddToCart: (pkg: Package) => void;
  onBack: () => void;
}

export function PackageDetails({ pkg, onAddToCart, onBack }: Props) {
  const discount = Math.round(((pkg.originalPrice - pkg.price) / pkg.originalPrice) * 100);

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-0 z-40 flex flex-col bg-app"
      style={{ maxWidth: "448px", margin: "0 auto" }}
    >
      {/* Header — title + back, single context action (not needed here) */}
      <div className="flex items-center gap-3 px-4 py-4 bg-white/90 backdrop-blur border-b border-gray-100 safe-top">
        <BackButton onClick={onBack} />
        <h1 className="text-[15px] font-bold text-[#164E63] flex-1 truncate">{pkg.nameAr}</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-28">
        {/* Hero image */}
        <div className="relative w-full aspect-[16/10] bg-gray-100">
          <Image
            src={pkg.mainImage}
            alt={pkg.nameAr}
            fill
            sizes="(min-width: 768px) 448px, 100vw"
            className="object-cover"
            priority
          />
          {pkg.badgeAr && (
            <span className="absolute top-3 start-3 bg-[#059669] text-white text-[11px] font-semibold px-2.5 py-1 rounded-full">
              {pkg.badgeAr}
            </span>
          )}
          {discount > 0 && (
            <span className="absolute top-3 end-3 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-md">
              -{discount}%
            </span>
          )}
        </div>

        {/* Title + price */}
        <div className="px-5 pt-5">
          <h2 className="text-xl font-bold text-[#164E63] leading-tight">{pkg.nameAr}</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">{pkg.fullDescriptionAr}</p>

          <div className="flex items-baseline gap-3 mt-4">
            <span className="text-2xl font-bold text-[#164E63]">{formatPrice(pkg.price)}</span>
            {pkg.originalPrice > pkg.price && (
              <span className="text-sm text-gray-400 line-through">{formatPrice(pkg.originalPrice)}</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">يشمل {pkg.tests.length} تحاليل</p>
        </div>

        {/* Tests included — full list lives ONLY here, not in cart */}
        <div className="px-5 mt-6">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">التحاليل المشمولة</h3>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {pkg.tests.map((test, i) => (
              <div
                key={test.id}
                className={`flex items-center gap-3 px-4 py-3 ${i < pkg.tests.length - 1 ? "border-b border-gray-50" : ""}`}
              >
                <div className="w-8 h-8 rounded-lg bg-[#ECFEFF] flex items-center justify-center flex-shrink-0">
                  <FlaskConical size={14} className="text-[#0891B2]" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#164E63] truncate">{test.nameAr}</p>
                  <p className="text-[11px] text-gray-400 lat truncate">{test.nameEn}</p>
                </div>
                <Check size={15} className="text-[#059669] flex-shrink-0" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>

        {/* What you get */}
        <div className="px-5 mt-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">ما الذي ستحصل عليه</h3>
          <ul className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {[
              "زيارة منزلية من ممرض معتمد",
              "تعليمات تحضير قبل الزيارة",
              "نتائج رقمية على تطبيقك",
              "متابعة دعم في حال أي ملاحظة",
            ].map((line) => (
              <li key={line} className="flex items-center gap-3 px-4 py-3">
                <div className="w-5 h-5 rounded-full bg-[#ECFEFF] flex items-center justify-center flex-shrink-0">
                  <Check size={11} strokeWidth={3} className="text-[#0891B2]" aria-hidden="true" />
                </div>
                <p className="text-sm text-[#164E63]">{line}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Sticky CTA — Add-to-cart lives ONLY on this page */}
      <div className="fixed bottom-0 start-0 end-0 px-4 py-3 bg-white border-t border-gray-100 safe-bottom z-10" style={{ maxWidth: "448px", margin: "0 auto" }}>
        <Button onClick={() => onAddToCart(pkg)} size="lg" className="w-full">
          <ShoppingCart size={18} aria-hidden="true" />
          أضف إلى السلة — {formatPrice(pkg.price)}
        </Button>
      </div>
    </motion.div>
  );
}
