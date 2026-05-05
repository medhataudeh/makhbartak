"use client";
import { useSyncExternalStore } from "react";
import type { ContentPage, ContentPageSlug } from "./types";
import { USE_SUPABASE, supabaseEnvReady } from "./supabase/flags";
import { getSupabaseBrowser } from "./supabase/client";
import { fetchContentPages } from "./supabase/queries/content-pages";

// Phase 3 production hardening: content_pages in Supabase is the only
// source of truth. Store boots empty; hydrate runs on first access. The
// MOCK_CONTENT_PAGES seed and localStorage cache are gone — admin edits
// land in the DB and customers read directly from there.

let _pages: ContentPage[] = [];
let _hydrated = false;
let _remoteHydrated = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function ensureHydrated() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  void hydrateFromSupabase();
}

async function hydrateFromSupabase() {
  if (_remoteHydrated) return;
  _remoteHydrated = true;
  if (!USE_SUPABASE || !supabaseEnvReady()) return;
  const sb = getSupabaseBrowser();
  if (!sb) return;
  try {
    const remote = await fetchContentPages(sb);
    if (remote) {
      _pages = remote;
      emit();
    }
  } catch (err) {
    console.warn("[supabase] content_pages hydrate failed", err);
  }
}

export function getContentPages(): ContentPage[] {
  if (!_hydrated) ensureHydrated();
  return _pages;
}

export function getContentPage(slug: ContentPageSlug): ContentPage | null {
  return getContentPages().find((p) => p.slug === slug) ?? null;
}

export async function updateContentPage(
  slug: ContentPageSlug,
  patch: Partial<ContentPage>,
): Promise<{ ok: boolean; error?: string }> {
  const current = _pages.find((p) => p.slug === slug);
  if (!current) {
    // Allow creation through the admin RPC even if the local cache is empty.
    if (!patch.titleAr) {
      return { ok: false, error: "page not found locally" };
    }
  }
  const titleAr = patch.titleAr ?? current?.titleAr ?? "";
  const bodyAr = patch.bodyAr ?? current?.bodyAr ?? null;
  const faqItems = patch.faqItems ?? current?.faqItems ?? null;
  const supportPhone = patch.supportPhone ?? current?.supportPhone ?? null;
  const supportWhatsapp = patch.supportWhatsapp ?? current?.supportWhatsapp ?? null;
  const isActive = patch.isActive ?? current?.isActive ?? true;

  // Optimistic local apply. The local placeholder id is replaced by the
  // canonical row id on the next hydrate; the initial render only needs a
  // stable string.
  const optimistic: ContentPage = {
    id: current?.id ?? `cp-${slug}`,
    slug,
    titleAr,
    bodyAr: bodyAr ?? "",
    faqItems: faqItems ?? undefined,
    supportPhone: supportPhone ?? undefined,
    supportWhatsapp: supportWhatsapp ?? undefined,
    isActive,
    updatedAt: new Date().toISOString(),
  };
  _pages = current
    ? _pages.map((p) => (p.slug === slug ? optimistic : p))
    : [..._pages, optimistic];
  emit();

  try {
    const res = await fetch("/api/admin/content-pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug, titleAr, bodyAr, faqItems, supportPhone, supportWhatsapp, isActive,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function useContentPages(): ContentPage[] {
  return useSyncExternalStore(subscribe, getContentPages, () => []);
}

export function useContentPage(slug: ContentPageSlug): ContentPage | null {
  return useSyncExternalStore(
    subscribe,
    () => getContentPage(slug),
    () => null,
  );
}
