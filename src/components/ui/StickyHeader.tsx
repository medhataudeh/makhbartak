"use client";
import { cn } from "@/lib/utils";

// Sticky top header for customer screens. The customer shell scrolls at the
// document/body level (no bounded scroll container), so this pins to the
// viewport top as the page scrolls — keeping the title + back button reachable
// at any scroll position. `sticky` stays in normal flow, so content naturally
// starts below it (no overlap, no manual top padding). `safe-top-md` reserves
// the notch / status-bar inset; the solid/blurred background keeps the title
// readable over scrolling content. RTL is inherited from <html dir="rtl">, and
// BackButton already points its arrow the correct way for Arabic.
export function StickyHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-gray-100 safe-top-md",
        className,
      )}
    >
      {children}
    </header>
  );
}
