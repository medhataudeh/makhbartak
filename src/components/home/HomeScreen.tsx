"use client";
import Image from "next/image";
import { motion } from "framer-motion";
import { Camera, FlaskConical, ShoppingCart, ChevronLeft, Bell } from "lucide-react";
import { useSliders } from "@/lib/home-sliders";
import { usePackages } from "@/lib/catalog";
import type { Package, SliderItem } from "@/lib/types";
import { HomeSlider } from "@/components/home/HomeSlider";

interface HomeScreenProps {
  onSelectPackage: (pkg: Package) => void;
  onPrescription: () => void;
  onCustomBuilder: () => void;
  cartCount: number;
  onCartClick: () => void;
  onNotificationsClick?: () => void;
  unreadNotifications?: number;
}

export function HomeScreen({
  onSelectPackage,
  onPrescription,
  onCustomBuilder,
  cartCount,
  onCartClick,
  onNotificationsClick,
  unreadNotifications = 0,
}: HomeScreenProps) {
  const packages = usePackages();
  const sliders = useSliders();
  // Resolve a slider item to an action (or null if there's nothing to do).
  // A null result tells HomeSlider to render the card as visually disabled
  // — no silent navigation to an unrelated screen, so admins notice broken
  // sliders instead of users landing somewhere unexpected.
  const resolveSliderAction = (item: SliderItem): (() => void) | null => {
    if (item.ctaTarget === "prescription") return onPrescription;
    if (item.ctaTarget === "custom-builder") return onCustomBuilder;
    if (item.ctaTarget === "package" && item.ctaTargetId) {
      const pkg = packages.find((p) => p.id === item.ctaTargetId);
      if (pkg) return () => onSelectPackage(pkg);
      console.warn(
        "[home-slider] disabled: package not found for ctaTargetId",
        { sliderId: item.id, titleAr: item.titleAr, ctaTargetId: item.ctaTargetId },
      );
      return null;
    }
    if (item.ctaTarget === "external" && item.ctaTargetId) {
      const url = item.ctaTargetId;
      return () => {
        if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
      };
    }
    console.warn("[home-slider] disabled: missing target", {
      sliderId: item.id, titleAr: item.titleAr, ctaTarget: item.ctaTarget,
    });
    return null;
  };
  const handleSliderCta = (item: SliderItem) => {
    const fn = resolveSliderAction(item);
    if (fn) fn();
  };

  return (
    <div className="flex flex-col pb-nav md:pb-12 bg-app min-h-screen">
      {/* HIG-style header — logo + notifications + cart on home */}
      <div className="flex items-center justify-between px-5 md:px-8 pt-5 pb-4 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#0891B2] flex items-center justify-center" aria-hidden="true">
            <FlaskConical size={18} className="text-white" />
          </div>
          <h1 className="text-lg md:text-xl font-bold text-[#164E63] tracking-tight">مختبرك</h1>
        </div>
        <div className="flex items-center gap-2">
          {onNotificationsClick && (
            <button
              onClick={onNotificationsClick}
              aria-label={unreadNotifications > 0 ? `الإشعارات — ${unreadNotifications} غير مقروء` : "الإشعارات"}
              className="relative w-11 h-11 bg-white rounded-xl border border-gray-100 flex items-center justify-center cursor-pointer transition-colors active:bg-gray-50"
            >
              <Bell size={19} className="text-[#164E63]" aria-hidden="true" />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
            </button>
          )}
          <button
            onClick={onCartClick}
            aria-label={cartCount > 0 ? `السلة — ${cartCount} عنصر` : "السلة"}
            className="relative w-11 h-11 bg-[#ECFEFF] rounded-xl flex items-center justify-center cursor-pointer transition-colors active:bg-cyan-100"
          >
            <ShoppingCart size={20} className="text-[#0891B2]" aria-hidden="true" />
            {cartCount > 0 && (
              <motion.span
                key={cartCount}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 18, stiffness: 350 }}
                className="absolute -top-1 -end-1 min-w-[18px] h-[18px] bg-[#059669] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1"
                aria-hidden="true"
              >
                {cartCount}
              </motion.span>
            )}
          </button>
        </div>
      </div>

      {/* Image-driven slider — the ONLY place packages surface on home now */}
      <div className="pt-4 md:pt-6">
        <HomeSlider items={sliders} onCta={handleSliderCta} resolveAction={resolveSliderAction} />
      </div>

      {/* Two visual action cards — Prescription + Custom builder.
         Always two columns: side-by-side on mobile, two-up on desktop. */}
      <div className="px-4 md:px-6 mt-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          أو ابدأ بطريقتك
        </h2>
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <ActionCard
            index={0}
            onClick={onPrescription}
            image="https://picsum.photos/seed/makhbartak-rx/800/520"
            badge={<Camera size={14} aria-hidden="true" />}
            badgeBg="bg-purple-600"
            titleAr="ارفع وصفة"
            descriptionAr="صوّر وصفة الطبيب وسنحدد التحاليل ونحجز الموعد"
            ctaAr="ارفع الآن"
            tint="from-purple-900/55 via-purple-900/15 to-transparent"
          />
          <ActionCard
            index={1}
            onClick={onCustomBuilder}
            image="https://picsum.photos/seed/makhbartak-custom/800/520"
            badge={<FlaskConical size={14} aria-hidden="true" />}
            badgeBg="bg-emerald-600"
            titleAr="اختر تحاليلك بنفسك"
            descriptionAr="ابحث وأضف ما تحتاج فقط — سعر شفّاف لكل تحليل"
            ctaAr="ابدأ الاختيار"
            tint="from-emerald-900/55 via-emerald-900/15 to-transparent"
          />
        </div>
      </div>
    </div>
  );
}

interface ActionCardProps {
  index: number;
  onClick: () => void;
  image: string;
  badge: React.ReactNode;
  badgeBg: string;
  titleAr: string;
  descriptionAr: string;
  ctaAr: string;
  tint: string;
}

function ActionCard({ index, onClick, image, badge, badgeBg, titleAr, descriptionAr, ctaAr, tint }: ActionCardProps) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + index * 0.07, duration: 0.25, ease: "easeOut" }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      aria-label={titleAr}
      className="relative w-full overflow-hidden rounded-2xl border border-gray-100 bg-white text-start cursor-pointer h-[200px] md:h-[200px] group"
    >
      <Image
        src={image}
        alt=""
        fill
        sizes="(min-width: 768px) 50vw, 50vw"
        className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      />
      <div className={`absolute inset-0 bg-gradient-to-t ${tint}`} aria-hidden="true" />
      <span className={`absolute top-3 start-3 inline-flex items-center justify-center w-8 h-8 rounded-lg ${badgeBg} text-white shadow-sm`} aria-hidden="true">
        {badge}
      </span>
      <div className="absolute inset-x-0 bottom-0 p-3 md:p-4">
        <p className="text-[15px] md:text-base font-bold text-white leading-tight">{titleAr}</p>
        <p className="text-[11px] md:text-xs text-white/85 mt-1 leading-relaxed line-clamp-2">{descriptionAr}</p>
        <span className="inline-flex items-center gap-1 mt-2 text-[11px] md:text-xs font-semibold text-white">
          {ctaAr}
          <ChevronLeft size={13} aria-hidden="true" />
        </span>
      </div>
    </motion.button>
  );
}
