"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, FlaskConical } from "lucide-react";
import type { SliderItem } from "@/lib/types";

interface HomeSliderProps {
  items: SliderItem[];
  onCta: (item: SliderItem) => void;
  /** Returns the action a slide is wired to, or null when it has none.
   *  Used to render unwired slides as visually static (no cursor/no click). */
  resolveAction?: (item: SliderItem) => (() => void) | null;
}

/**
 * Image-driven hero carousel.
 *  - Mobile (< md):  one tall card per page, swipeable, dot indicator.
 *  - Tablet/desktop: 3-up grid of vertical cards, no swipe needed.
 *
 * Direction note: the app is RTL (`dir="rtl"`). "Next" therefore advances the
 * index while the slide motion + swipe gesture read right-to-left: a rightward
 * drag advances, and the incoming slide enters from the left. `dir` (+1 next /
 * -1 prev) drives the framer-motion variants so the animation mirrors the
 * gesture instead of using LTR math.
 */
// Enter/exit offsets are mirrored for RTL: advancing (dir +1) brings the new
// slide in from the left and pushes the old one out to the right.
const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir >= 0 ? -28 : 28 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir >= 0 ? 28 : -28 }),
};

export function HomeSlider({ items, onCta, resolveAction }: HomeSliderProps) {
  const isClickable = (item: SliderItem) =>
    resolveAction ? resolveAction(item) != null : true;
  const active = items.filter((s) => s.isActive).sort((a, b) => a.displayOrder - b.displayOrder);
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-advance on mobile every 6s; pause if user has interacted recently.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || active.length <= 1) return;
    const t = window.setTimeout(() => { setDir(1); setPage((p) => (p + 1) % active.length); }, 6000);
    return () => window.clearTimeout(t);
  }, [page, paused, active.length]);

  if (active.length === 0) return null;

  // RTL-correct navigation: a rightward swipe advances ("next").
  const goNext = () => { setPaused(true); setDir(1); setPage((p) => (p + 1) % active.length); };
  const goPrev = () => { setPaused(true); setDir(-1); setPage((p) => (p - 1 + active.length) % active.length); };

  return (
    <div className="px-4 md:px-6">
      {/* Desktop / tablet — 3-up grid */}
      <div className="hidden md:grid md:grid-cols-3 gap-4 lg:gap-5">
        {active.slice(0, 3).map((item) => (
          <SlideCard
            key={item.id}
            item={item}
            onCta={onCta}
            variant="desktop"
            clickable={isClickable(item)}
          />
        ))}
      </div>

      {/* Mobile — single swipeable card */}
      <div className="md:hidden" ref={containerRef}>
        <div
          className="overflow-hidden touch-pan-y"
          onPointerDown={() => setPaused(true)}
        >
          <AnimatePresence initial={false} mode="wait" custom={dir}>
            <motion.div
              key={active[page].id}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.18}
              onDragEnd={(_, info) => {
                // RTL: drag right → next, drag left → previous.
                if (info.offset.x > 60 || info.velocity.x > 300) goNext();
                else if (info.offset.x < -60 || info.velocity.x < -300) goPrev();
              }}
            >
              <SlideCard
                item={active[page]}
                onCta={onCta}
                variant="mobile"
                clickable={isClickable(active[page])}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Dot indicator */}
        {active.length > 1 && (
          <div
            className="flex justify-center gap-1.5 mt-3"
            role="tablist"
            aria-label="مؤشر السلايدر"
          >
            {active.map((s, i) => (
              <button
                key={s.id}
                onClick={() => { setPaused(true); setDir(i >= page ? 1 : -1); setPage(i); }}
                role="tab"
                aria-selected={page === i}
                aria-label={`الانتقال إلى ${s.titleAr}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  page === i ? "w-6 bg-[#0891B2]" : "w-1.5 bg-gray-300"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SlideCard({
  item,
  onCta,
  variant,
  clickable,
}: {
  item: SliderItem;
  onCta: (item: SliderItem) => void;
  variant: "mobile" | "desktop";
  clickable: boolean;
}) {
  const src = variant === "mobile" ? item.mobileImage : item.desktopImage;
  return (
    <article
      className={`relative rounded-2xl overflow-hidden bg-[#164E63] aspect-[4/5] md:aspect-[3/4] lg:aspect-[4/5] group ${
        clickable ? "cursor-pointer" : "cursor-default"
      }`}
      onClick={() => { if (clickable) onCta(item); }}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCta(item); }
      }}
    >
      <Image
        src={src}
        alt={item.titleAr}
        fill
        sizes="(min-width: 1024px) 33vw, (min-width: 768px) 33vw, 100vw"
        className="object-cover transition-transform duration-700 group-hover:scale-105"
        priority={item.displayOrder <= 2}
        draggable={false}
      />
      {/* Bottom-anchored gradient — just enough contrast under the text while
         leaving the top ~⅓ of the artwork clear (was a full-card from-black/75
         veil that dimmed the whole image). */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/65 via-black/20 to-transparent"
      />

      {/* Badge */}
      {item.badgeAr && (
        <span className="absolute top-3 start-3 bg-[#059669] text-white text-[11px] font-semibold px-2.5 py-1 rounded-full">
          {item.badgeAr}
        </span>
      )}

      {/* Tests count chip */}
      {item.testsCount != null && (
        <span className="absolute top-3 end-3 bg-white/95 text-[#0E7490] text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
          <FlaskConical size={11} aria-hidden="true" />
          {item.testsCount} تحليل
        </span>
      )}

      {/* Content */}
      <div className="absolute inset-x-0 bottom-0 p-4 md:p-5 text-white">
        <h2 className="text-[17px] md:text-lg font-bold leading-snug mb-1.5 drop-shadow">
          {item.titleAr}
        </h2>
        <p className="text-[13px] md:text-sm text-white/85 leading-relaxed mb-3 line-clamp-2">
          {item.subtitleAr}
        </p>

        <div className="flex items-center justify-between gap-3">
          <span className="text-base md:text-lg font-bold drop-shadow">{item.priceLabel}</span>
          {clickable && item.ctaLabel && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCta(item); }}
              className="inline-flex items-center gap-1.5 bg-white text-[#0E7490] font-semibold text-[13px] px-3.5 py-2 rounded-xl active:scale-95 transition-transform"
              aria-label={item.ctaLabel}
            >
              {item.ctaLabel}
              <ArrowLeft size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
