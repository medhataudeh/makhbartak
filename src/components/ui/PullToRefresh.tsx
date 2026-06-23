"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";

// Mobile-style pull-to-refresh. Engages ONLY when the document is scrolled to
// the very top and the finger drags downward past a small slop, so normal
// scrolling and taps are untouched. Touch-only by design — desktop (mouse /
// wheel / trackpad) never triggers it, so desktop scroll is unaffected.
// Animates transform/opacity only (per the motion rules); prefers-reduced-motion
// is honored globally in globals.css.

const THRESHOLD = 72;   // px of pull (post-resistance) needed to trigger
const MAX_PULL = 112;   // visual clamp
const RESISTANCE = 0.5; // rubber-band damping
const SLOP = 8;         // px before we "own" the gesture

export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const engaged = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const apply = (v: number) => { pullRef.current = v; setPull(v); };

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || window.scrollY > 0) { startY.current = null; return; }
      startY.current = e.touches[0].clientY;
      engaged.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current === null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      // Pulling up, or the page scrolled away from the top → abandon.
      if (dy <= 0 || window.scrollY > 0) {
        if (engaged.current) apply(0);
        engaged.current = false;
        if (window.scrollY > 0) startY.current = null;
        return;
      }
      if (dy > SLOP) engaged.current = true;
      if (engaged.current) {
        // We own the gesture: stop the native overscroll bounce from fighting us.
        e.preventDefault();
        apply(Math.min(MAX_PULL, dy * RESISTANCE));
      }
    };

    const onEnd = () => {
      if (startY.current === null) return;
      const trigger = engaged.current && pullRef.current >= THRESHOLD && !refreshingRef.current;
      startY.current = null;
      engaged.current = false;
      if (!trigger) { apply(0); return; }
      refreshingRef.current = true;
      setRefreshing(true);
      apply(56); // hold the spinner inline while refreshing
      void (async () => {
        try { await onRefreshRef.current(); }
        finally {
          refreshingRef.current = false;
          setRefreshing(false);
          apply(0);
        }
      })();
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const active = pull > 0 || refreshing;
  const ready = pull >= THRESHOLD;

  return (
    <div ref={containerRef} className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center overflow-hidden"
        style={{ height: pull, opacity: active ? 1 : 0 }}
        aria-hidden="true"
      >
        <div className="mt-2 flex items-center justify-center w-9 h-9 rounded-full bg-white border border-gray-100">
          {refreshing ? (
            <Loader2 size={18} className="text-[#0891B2] animate-spin" />
          ) : (
            <ArrowDown
              size={18}
              className="text-[#0891B2]"
              style={{ transform: ready ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s ease-out" }}
            />
          )}
        </div>
      </div>

      <div
        style={{
          transform: active ? `translateY(${pull}px)` : undefined,
          transition: pull === 0 ? "transform 0.2s ease-out" : undefined,
        }}
      >
        {children}
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {refreshing ? "جارٍ تحديث الصفحة الرئيسية" : ""}
      </span>
    </div>
  );
}
