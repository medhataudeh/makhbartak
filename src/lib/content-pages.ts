"use client";
import { useSyncExternalStore } from "react";
import type { ContentPage, ContentPageSlug } from "./types";
import { MOCK_CONTENT_PAGES } from "./mock-data";

const KEY = "makhbartak.content-pages.v1";

let _pages: ContentPage[] = [...MOCK_CONTENT_PAGES];
let _hydrated = false;
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
      // Merge: any persisted page overrides the seed by slug.
      const bySlug = new Map(overrides.map((p) => [p.slug, p]));
      _pages = MOCK_CONTENT_PAGES.map((p) => bySlug.get(p.slug) ?? p);
    }
  } catch {}
  emit();
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

export function updateContentPage(slug: ContentPageSlug, patch: Partial<ContentPage>): void {
  _pages = _pages.map((p) => p.slug === slug
    ? { ...p, ...patch, updatedAt: new Date().toISOString() }
    : p);
  persist();
  emit();
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
