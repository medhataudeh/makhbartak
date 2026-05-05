"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { Lab } from "./types";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";

// Phase 3: lab editable rows are pulled directly from /api/labs/[id].
// MOCK_LABS + localStorage are gone; the lab portal fetches the canonical
// row on mount. Critical fields are still locked client-side and
// re-validated server-side by upsert_lab_admin.

export const CRITICAL_LAB_FIELDS = [
  "officialName", "registrationNumber", "licenseNumber", "taxNumber",
  "addressFull", "lat", "lng", "revealSellPriceToLab",
] as const;
export type CriticalLabField = typeof CRITICAL_LAB_FIELDS[number];

const _byId = new Map<string, Lab>();
const _hydratedIds = new Set<string>();
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function getOne(id: string): Lab | null {
  return _byId.get(id) ?? null;
}

interface RawLabRow {
  id: string;
  name_ar?: string;
  name_en?: string;
  phone_main?: string;
  city?: string;
  reveal_sell_price_to_lab?: boolean;
  branding?: Lab["branding"];
  logo_url?: string;
  is_active?: boolean;
}

async function hydrateOne(id: string) {
  if (_hydratedIds.has(id)) return;
  _hydratedIds.add(id);
  if (!USE_SUPABASE || !isUuid(id)) return;
  try {
    const res = await fetch(`/api/labs/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    const r = body?.lab as RawLabRow | null | undefined;
    if (!r) return;
    const lab: Lab = {
      id: r.id,
      name: r.name_ar ?? "",
      nameAr: r.name_ar ?? "",
      nameEn: r.name_en ?? "",
      phone: r.phone_main ?? "",
      city: r.city ?? "",
      logo: r.logo_url,
      branding: r.branding,
      isActive: r.is_active ?? true,
      revealSellPriceToLab: r.reveal_sell_price_to_lab ?? false,
    } as Lab;
    _byId.set(id, lab);
    emit();
  } catch (err) {
    console.warn("[api/labs] hydrate failed", err);
  }
}

export function getEditableLab(id: string): Lab | null { return getOne(id); }

export function useEditableLab(id: string): Lab | null {
  useEffect(() => { void hydrateOne(id); }, [id]);
  return useSyncExternalStore(
    subscribe,
    () => getOne(id),
    () => null,
  );
}

/** Lab-admin update — strips critical fields if accidentally included. */
export async function updateLabSelf(id: string, patch: Partial<Lab>): Promise<{ ok: boolean; error?: string }> {
  const safe: Partial<Lab> = { ...patch };
  for (const f of CRITICAL_LAB_FIELDS) {
    delete (safe as Record<string, unknown>)[f];
  }
  if (!USE_SUPABASE) {
    const current = _byId.get(id);
    if (current) { _byId.set(id, { ...current, ...safe }); emit(); }
    return { ok: true };
  }
  if (!isUuid(id)) return { ok: false, error: "lab id must be a uuid" };
  const session = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "lab" && session.role !== "admin")) {
    return { ok: false, error: "session not authenticated" };
  }
  const camelToSnake: Record<string, string> = {
    nameAr: "name_ar", nameEn: "name_en", logo: "logo_url", logoUrl: "logo_url",
    phone: "phone_main", phoneMain: "phone_main", phoneSecondary: "phone_secondary",
    email: "email", whatsapp: "whatsapp",
    representativeName: "representative_name", representativeRole: "representative_role",
    representativePhone: "representative_phone", representativeEmail: "representative_email",
    workingHours: "working_hours", avgProcessingHours: "avg_processing_hours",
    primaryColor: "primary_color", secondaryColor: "secondary_color", accentColor: "accent_color",
    portalDisplayName: "portal_display_name", headerImageUrl: "header_image_url",
  };
  const wire: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(safe)) {
    const snake = camelToSnake[k];
    if (snake) wire[snake] = v;
  }
  const { apiPatchLab } = await import("./lab-api");
  const r = await apiPatchLab(id, wire);
  if (!r.ok) return r;
  // Mirror locally only after server confirms.
  const current = _byId.get(id);
  if (current) { _byId.set(id, { ...current, ...safe }); emit(); }
  return { ok: true };
}
