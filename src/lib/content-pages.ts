"use client";
import { useSyncExternalStore } from "react";
import type { ContentPage, ContentPageSlug } from "./types";
import { MOCK_CONTENT_PAGES } from "./mock-data";
import { USE_SUPABASE, supabaseEnvReady } from "./supabase/flags";
import { getSupabaseBrowser } from "./supabase/client";
import { fetchContentPages } from "./supabase/queries/content-pages";

const KEY = "makhbartak.content-pages.v1";

let _pages: ContentPage[] = [...MOCK_CONTENT_PAGES];
let _hydrated = false;
let _remoteHydrated = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const overrides = JSON.parse(raw) as ContentPage[];
      const bySlug = new Map(overrides.map((p) => [p.slug, p]));
      _pages = MOCK_CONTENT_PAGES.map((p) => bySlug.get(p.slug) ?? p);
    }
  } catch {}
  emit();
  hydrateFromSupabase();
}

async function hydrateFromSupabase() {
  if (_remoteHydrated) return;
  _remoteHydrated = true;
  if (!USE_SUPABASE || !supabaseEnvReady()) return;
  const sb = getSupabaseBrowser();
  if (!sb) return;
  try {
    const remote = await fetchContentPages(sb);
    if (remote && remote.length) {
      const bySlug = new Map(remote.map((p) => [p.slug, p]));
      _pages = MOCK_CONTENT_PAGES.map((p) => bySlug.get(p.slug) ?? p);
      emit();
    }
  } catch (err) {
    console.warn("[supabase] content_pages hydrate failed; using local", err);
  }
}

function persist() {
  try { window.localStorage.setItem(KEY, JSON.stringify(_pages)); } catch {}
}

export function getContentPages(): ContentPage[] {
  if (!_hydrated) hydrate();
  return _pages;
}

export function getContentPage(slug: ContentPageSlug): ContentPage | null {
  return getContentPages().find((p) => p.slug === slug) ?? null;
}

export function updateContentPage(slug: ContentPageSlug, patch: Partial<ContentPage>): Promise<{ ok: boolean; error?: string }> {
  _pages = _pages.map((p) => p.slug === slug
    ? { ...p, ...patch, updatedAt: new Date().toISOString() }
    : p);
  persist();
  emit();
  return persistContentPageViaApi(slug, patch);
}

async function persistContentPageViaApi(
  slug: ContentPageSlug,
  patch: Partial<ContentPage>,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  const session = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return { ok: true };
  // Look up the canonical row to fill required fields the patch may have
  // omitted (titleAr is required at the RPC level).
  const current = _pages.find((p) => p.slug === slug);
  if (!current) return { ok: false, error: "page not found" };
  const res = await fetch("/api/admin/content-pages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session,
      slug: slug,
      titleAr: patch.titleAr ?? current.titleAr,
      bodyAr: patch.bodyAr ?? current.bodyAr,
      faqItems: patch.faqItems ?? current.faqItems ?? null,
      supportPhone: patch.supportPhone ?? current.supportPhone,
      supportWhatsapp: patch.supportWhatsapp ?? current.supportWhatsapp,
      isActive: patch.isActive ?? current.isActive,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export function useContentPages(): ContentPage[] {
  return useSyncExternalStore(subscribe, getContentPages, () => MOCK_CONTENT_PAGES);
}

export function useContentPage(slug: ContentPageSlug): ContentPage | null {
  return useSyncExternalStore(
    subscribe,
    () => getContentPage(slug),
    () => MOCK_CONTENT_PAGES.find((p) => p.slug === slug) ?? null,
  );
}
