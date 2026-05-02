import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number) {
  return `${price.toLocaleString("ar-SY")} ل.س`;
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("ar-SY", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

export function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("ar-SY", {
    hour: "2-digit", minute: "2-digit",
  });
}

export function searchTests(tests: import("./types").Test[], query: string) {
  if (!query.trim()) return tests;
  const q = query.toLowerCase().trim();
  return tests.filter((t) => {
    return (
      t.nameAr.toLowerCase().includes(q) ||
      t.nameEn.toLowerCase().includes(q) ||
      t.shortName.toLowerCase().includes(q) ||
      t.aliasesAr.some((a) => a.toLowerCase().includes(q)) ||
      t.aliasesEn.some((a) => a.toLowerCase().includes(q))
    );
  });
}

export function getShiftLabel(shift: "morning" | "evening") {
  return shift === "morning" ? "فترة الصباح (8:00 – 10:00)" : "فترة المساء (4:00 – 6:00)";
}

export function getShiftTime(shift: "morning" | "evening") {
  return shift === "morning" ? "8:00 – 10:00 ص" : "4:00 – 6:00 م";
}

export function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}
