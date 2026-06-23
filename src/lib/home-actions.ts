"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { HomeActionSection } from "./types";
import { USE_SUPABASE } from "./supabase/flags";

// Customer-facing home action cards ("أو ابدأ بطريقتك"). DB-driven via the
// public GET /api/home-actions (active rows, safe fields only). If hydration
// hasn't happened or the table is empty, HomeScreen falls back to
// DEFAULT_HOME_ACTIONS so the home never renders a broken/empty section — but
// the database is the source of truth once it has rows.

// Safe fallback for first paint / empty settings. Mirrors the two original
// hardcoded cards so the home is never blank.
export const DEFAULT_HOME_ACTIONS: HomeActionSection[] = [
  {
    id: "default-prescription",
    titleAr: "ارفع وصفة",
    descriptionAr: "صوّر وصفة الطبيب وسنحدد التحاليل ونحجز الموعد",
    ctaLabelAr: "ارفع الآن",
    actionType: "prescription",
    icon: "Camera",
    imageUrl: "https://picsum.photos/seed/makhbartak-rx/800/520",
    accent: "purple",
    displayOrder: 1,
    isActive: true,
  },
  {
    id: "default-custom-builder",
    titleAr: "اختر تحاليلك بنفسك",
    descriptionAr: "ابحث وأضف ما تحتاج فقط — سعر شفّاف لكل تحليل",
    ctaLabelAr: "ابدأ الاختيار",
    actionType: "custom-builder",
    icon: "FlaskConical",
    imageUrl: "https://picsum.photos/seed/makhbartak-custom/800/520",
    accent: "emerald",
    displayOrder: 2,
    isActive: true,
  },
];

// Curated icon + accent vocabularies shared by the admin form and the
// HomeScreen renderer (which maps the names to lucide components / classes).
export const HOME_ACTION_ICON_NAMES = [
  "Camera", "FlaskConical", "Upload", "Search", "ClipboardList",
  "Stethoscope", "Beaker", "FileText", "HeartPulse", "Plus",
] as const;

export const HOME_ACTION_ACCENTS = ["purple", "emerald", "cyan", "amber"] as const;

interface RawHomeAction {
  id: string;
  title_ar: string;
  description_ar: string | null;
  cta_label_ar: string | null;
  action_type: HomeActionSection["actionType"];
  action_value: string | null;
  icon: string | null;
  image_url: string | null;
  accent: string | null;
  display_order: number;
  is_active: boolean;
}

export function mapHomeAction(r: RawHomeAction): HomeActionSection {
  return {
    id: r.id,
    titleAr: r.title_ar,
    descriptionAr: r.description_ar ?? "",
    ctaLabelAr: r.cta_label_ar ?? "",
    actionType: r.action_type,
    actionValue: r.action_value ?? undefined,
    icon: r.icon ?? "FlaskConical",
    imageUrl: r.image_url ?? "",
    accent: r.accent ?? "cyan",
    displayOrder: r.display_order,
    isActive: r.is_active,
  };
}

let _actions: HomeActionSection[] = [];
let _hydratedOnce = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function getHomeActions(): HomeActionSection[] { return _actions; }

async function fetchHomeActions(): Promise<void> {
  if (!USE_SUPABASE) return;
  try {
    const res = await fetch("/api/home-actions", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    if (!Array.isArray(body?.sections)) return;
    _actions = (body.sections as RawHomeAction[])
      .map(mapHomeAction)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    emit();
  } catch {
    // Network failure: keep empty → HomeScreen renders DEFAULT_HOME_ACTIONS.
  }
}

export function useHomeActions(): HomeActionSection[] {
  useEffect(() => {
    if (_hydratedOnce) return;
    _hydratedOnce = true;
    void fetchHomeActions();
  }, []);
  return useSyncExternalStore(subscribe, getHomeActions, () => []);
}

// Force a re-fetch (e.g. pull-to-refresh on the customer home).
export async function refreshHomeActions(): Promise<void> {
  _hydratedOnce = true;
  await fetchHomeActions();
}
