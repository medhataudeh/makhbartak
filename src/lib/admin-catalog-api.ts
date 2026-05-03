"use client";
import type { Coupon, Package, SliderItem, Test } from "@/lib/types";

// Stage F follow-up: thin client wrappers around the existing Stage F admin
// routes. Wires the AdminDashboard sub-component setters through Supabase so
// edits are durable.

// ─── Common helpers ────────────────────────────────────────────────────────
async function postJson<T>(url: string, body: unknown): Promise<T | { error: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { error: j.error ?? `HTTP ${res.status}` };
  }
  return res.json() as Promise<T>;
}

async function deleteJson(url: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { ok: false, error: j.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

// ─── Tests ──────────────────────────────────────────────────────────────────
interface RawTest {
  id: string; category_id: string | null;
  name_ar: string; name_en: string | null; short_name: string | null;
  aliases_ar: string[] | null; aliases_en: string[] | null;
  sample_type: string;
  cost_price: number | string; sell_price: number | string;
  is_active: boolean;
}

function mapTest(r: RawTest): Test {
  return {
    id: r.id,
    nameAr: r.name_ar,
    nameEn: r.name_en ?? "",
    shortName: r.short_name ?? "",
    aliasesAr: r.aliases_ar ?? [],
    aliasesEn: r.aliases_en ?? [],
    categoryId: r.category_id ?? "",
    sampleType: r.sample_type,
    costPrice: Number(r.cost_price),
    sellPrice: Number(r.sell_price),
    instructionsAr: [],
    tools: [],
    isActive: r.is_active,
  };
}

export async function hydrateAdminTests(): Promise<Test[] | null> {
  const res = await fetch("/api/admin/tests", { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.tests) ? (body.tests as RawTest[]).map(mapTest) : null;
}

export async function apiUpsertTest(
  t: Test,
): Promise<{ ok: boolean; test?: Test; error?: string }> {
  const wire = {
    id: t.id || undefined,
    categoryId: t.categoryId || undefined,
    nameAr: t.nameAr,
    nameEn: t.nameEn || undefined,
    shortName: t.shortName || undefined,
    aliasesAr: t.aliasesAr,
    aliasesEn: t.aliasesEn,
    sampleType: t.sampleType,
    costPrice: t.costPrice,
    sellPrice: t.sellPrice,
    isActive: t.isActive,
  };
  const result = await postJson<{ id: string }>("/api/admin/tests", wire);
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, test: { ...t, id: result.id } };
}

export async function apiDeleteTest(id: string): Promise<{ ok: boolean; error?: string }> {
  return deleteJson(`/api/admin/tests/${encodeURIComponent(id)}`);
}

// ─── Packages ───────────────────────────────────────────────────────────────
interface RawPackage {
  id: string;
  name_ar: string; name_en: string | null;
  description_ar: string | null; full_description_ar: string | null;
  category: string | null;
  price: number | string; original_price: number | string;
  main_image_url: string | null; mobile_image_url: string | null; desktop_image_url: string | null;
  badge_ar: string | null;
  display_order: number; show_in_slider: boolean; is_active: boolean;
  items: Array<{ lab_test_id: string; display_order: number }> | null;
}

function mapPackage(r: RawPackage, allTests: Test[]): Package {
  const linkedTests = (r.items ?? [])
    .sort((a, b) => a.display_order - b.display_order)
    .map((it) => allTests.find((t) => t.id === it.lab_test_id))
    .filter(Boolean) as Test[];
  return {
    id: r.id,
    nameAr: r.name_ar,
    nameEn: r.name_en ?? "",
    descriptionAr: r.description_ar ?? "",
    fullDescriptionAr: r.full_description_ar ?? "",
    category: (r.category as Package["category"]) ?? "all",
    tests: linkedTests,
    price: Number(r.price),
    originalPrice: Number(r.original_price),
    mainImage: r.main_image_url ?? "",
    mobileImage: r.mobile_image_url ?? "",
    desktopImage: r.desktop_image_url ?? "",
    badgeAr: r.badge_ar ?? undefined,
    displayOrder: r.display_order,
    showInSlider: r.show_in_slider,
    isActive: r.is_active,
  };
}

export async function hydrateAdminPackages(allTests: Test[]): Promise<Package[] | null> {
  const res = await fetch("/api/admin/packages", { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.packages)
    ? (body.packages as RawPackage[]).map((r) => mapPackage(r, allTests))
    : null;
}

export async function apiUpsertPackage(
  p: Package,
): Promise<{ ok: boolean; pkg?: Package; error?: string }> {
  const wire = {
    id: p.id || undefined,
    nameAr: p.nameAr,
    nameEn: p.nameEn || undefined,
    descriptionAr: p.descriptionAr || undefined,
    fullDescriptionAr: p.fullDescriptionAr || undefined,
    category: p.category,
    price: p.price,
    originalPrice: p.originalPrice,
    mainImageUrl: p.mainImage || undefined,
    mobileImageUrl: p.mobileImage || undefined,
    desktopImageUrl: p.desktopImage || undefined,
    badgeAr: p.badgeAr,
    displayOrder: p.displayOrder,
    showInSlider: p.showInSlider,
    isActive: p.isActive,
    testIds: p.tests.map((t) => t.id),
  };
  const result = await postJson<{ id: string }>("/api/admin/packages", wire);
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, pkg: { ...p, id: result.id } };
}

export async function apiDeletePackage(id: string): Promise<{ ok: boolean; error?: string }> {
  return deleteJson(`/api/admin/packages/${encodeURIComponent(id)}`);
}

// ─── Coupons ───────────────────────────────────────────────────────────────
interface RawCoupon {
  id: string; code: string; type: "percentage" | "fixed";
  value: number | string;
  min_order_amount: number | string; max_discount: number | string;
  usage_limit: number; used_count: number;
  start_date: string; expiry_date: string;
  is_active: boolean;
}

function mapCoupon(r: RawCoupon): Coupon {
  return {
    id: r.id,
    code: r.code,
    type: r.type,
    value: Number(r.value),
    minOrderAmount: Number(r.min_order_amount),
    maxDiscount: Number(r.max_discount),
    usageLimit: r.usage_limit,
    usedCount: r.used_count,
    startDate: r.start_date,
    expiryDate: r.expiry_date,
    isActive: r.is_active,
  };
}

export async function hydrateAdminCoupons(): Promise<Coupon[] | null> {
  const res = await fetch("/api/admin/coupons", { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.coupons) ? (body.coupons as RawCoupon[]).map(mapCoupon) : null;
}

export async function apiUpsertCoupon(
  c: Coupon,
): Promise<{ ok: boolean; coupon?: Coupon; error?: string }> {
  const wire = {
    id: c.id || undefined,
    code: c.code,
    type: c.type,
    value: c.value,
    minOrderAmount: c.minOrderAmount,
    maxDiscount: c.maxDiscount,
    usageLimit: c.usageLimit,
    startDate: c.startDate,
    expiryDate: c.expiryDate,
    isActive: c.isActive,
  };
  const result = await postJson<{ id: string }>("/api/admin/coupons", wire);
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, coupon: { ...c, id: result.id } };
}

export async function apiDeleteCoupon(id: string): Promise<{ ok: boolean; error?: string }> {
  return deleteJson(`/api/admin/coupons/${encodeURIComponent(id)}`);
}

// Customer/admin-side coupon validation. Single source of truth: server.
export interface CouponValidation {
  valid: boolean;
  message: string;
  discount?: number;
  coupon?: { id: string; code: string; type: "percentage" | "fixed"; value: number; maxDiscount: number; minOrderAmount: number };
}

export async function apiValidateCoupon(code: string, total: number): Promise<CouponValidation> {
  try {
    const res = await fetch(
      `/api/coupons/validate?code=${encodeURIComponent(code)}&total=${encodeURIComponent(total)}`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => ({}));
    return body as CouponValidation;
  } catch {
    return { valid: false, message: "تعذر التحقق من الكوبون" };
  }
}

// ─── Sliders ───────────────────────────────────────────────────────────────
interface RawSlider {
  id: string;
  title_ar: string; subtitle_ar: string | null;
  mobile_image: string | null; desktop_image: string | null;
  price_label: string | null; cta_label: string | null;
  cta_target: SliderItem["ctaTarget"];
  cta_target_id: string | null;
  tests_count: number | null;
  badge_ar: string | null;
  display_order: number; is_active: boolean;
}

function mapSlider(r: RawSlider): SliderItem {
  return {
    id: r.id,
    titleAr: r.title_ar,
    subtitleAr: r.subtitle_ar ?? "",
    mobileImage: r.mobile_image ?? "",
    desktopImage: r.desktop_image ?? "",
    priceLabel: r.price_label ?? "",
    ctaLabel: r.cta_label ?? "",
    ctaTarget: r.cta_target,
    ctaTargetId: r.cta_target_id ?? undefined,
    testsCount: r.tests_count ?? undefined,
    badgeAr: r.badge_ar ?? undefined,
    displayOrder: r.display_order,
    isActive: r.is_active,
  };
}

export async function hydrateAdminSliders(): Promise<SliderItem[] | null> {
  const res = await fetch("/api/admin/sliders", { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.sliders) ? (body.sliders as RawSlider[]).map(mapSlider) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function apiUpsertSlider(
  s: SliderItem,
): Promise<{ ok: boolean; slider?: SliderItem; error?: string }> {
  // Strip any non-UUID id (e.g. local "sl-..." placeholder) before hitting
  // the server — the SQL column is uuid and would reject anything else.
  const safeId = s.id && UUID_RE.test(s.id) ? s.id : undefined;
  const safeTargetId =
    s.ctaTarget === "package" && s.ctaTargetId && UUID_RE.test(s.ctaTargetId)
      ? s.ctaTargetId
      : undefined;
  if (s.ctaTarget === "package" && !safeTargetId) {
    return { ok: false, error: "اختر باقة صحيحة من القائمة" };
  }
  const wire = {
    id: safeId,
    titleAr: s.titleAr,
    subtitleAr: s.subtitleAr || undefined,
    mobileImage: s.mobileImage || undefined,
    desktopImage: s.desktopImage || undefined,
    priceLabel: s.priceLabel || undefined,
    ctaLabel: s.ctaLabel || undefined,
    ctaTarget: s.ctaTarget,
    ctaTargetId: safeTargetId,
    testsCount: s.testsCount,
    badgeAr: s.badgeAr,
    displayOrder: s.displayOrder,
    isActive: s.isActive,
  };
  const result = await postJson<{ id: string }>("/api/admin/sliders", wire);
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, slider: { ...s, id: result.id, ctaTargetId: safeTargetId } };
}

export async function apiDeleteSlider(id: string): Promise<{ ok: boolean; error?: string }> {
  return deleteJson(`/api/admin/sliders/${encodeURIComponent(id)}`);
}
