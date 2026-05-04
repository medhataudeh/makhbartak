"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { OrderRating } from "./types";
import { isUuid } from "./supabase/uuid";
import { USE_SUPABASE } from "./supabase/flags";

// Phase 1 production hardening: ratings are now persisted in Supabase via
// the `order_ratings` table + `/api/orders/[id]/rating`. The local store is
// a per-tab cache so OrderRatingCard can render the "thank you" summary
// without re-fetching after the customer hits submit.

let _ratings: OrderRating[] = [];
const _hydrated = new Set<string>();
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

interface RawRatingRow {
  id: string;
  order_id: string;
  customer_id: string;
  nurse_id: string | null;
  lab_id: string | null;
  overall_rating: number;
  nurse_rating: number | null;
  lab_rating: number | null;
  comment: string | null;
  created_at: string;
}

function rowToRating(r: RawRatingRow): OrderRating {
  return {
    id: r.id,
    orderId: r.order_id,
    userId: r.customer_id,
    nurseId: r.nurse_id ?? undefined,
    labId: r.lab_id ?? undefined,
    overallRating: r.overall_rating,
    nurseRating: r.nurse_rating ?? undefined,
    labRating: r.lab_rating ?? undefined,
    comment: r.comment ?? undefined,
    createdAt: r.created_at,
  };
}

function upsertLocal(r: OrderRating) {
  _ratings = [r, ..._ratings.filter((x) => x.orderId !== r.orderId)];
  emit();
}

export function getRatings(): OrderRating[] { return _ratings; }
export function getRatingForOrder(orderId: string): OrderRating | null {
  return _ratings.find((r) => r.orderId === orderId) ?? null;
}

export async function hydrateRatingForOrder(orderId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(orderId)) return;
  if (_hydrated.has(orderId)) return;
  _hydrated.add(orderId);
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/rating`, { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    const row = body?.rating as RawRatingRow | null | undefined;
    if (row) upsertLocal(rowToRating(row));
  } catch {
    // Silent: card just shows the empty form on a network failure.
  }
}

export function useOrderRating(orderId: string): OrderRating | null {
  // Pull the row once on mount when the flag is on. Card-side cache covers
  // the same-tab "submitted just now" path.
  useEffect(() => { void hydrateRatingForOrder(orderId); }, [orderId]);
  return useSyncExternalStore(
    subscribe,
    () => getRatingForOrder(orderId),
    () => null,
  );
}

interface SubmitInput {
  orderId: string;
  userId: string;
  nurseId?: string;
  labId?: string;
  nurseRating?: number;
  labRating?: number;
  overallRating: number;
  comment?: string;
}

export async function submitOrderRating(input: SubmitInput): Promise<{ ok: boolean; rating?: OrderRating; error?: string }> {
  if (!isUuid(input.orderId)) {
    return { ok: false, error: "هذا الطلب غير صالح للتقييم" };
  }
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(input.orderId)}/rating`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        overallRating: input.overallRating,
        nurseRating: input.nurseRating ?? null,
        labRating: input.labRating ?? null,
        comment: input.comment ?? null,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: (body as { error?: string } | null)?.error ?? `HTTP ${res.status}` };
    }
    const row = (body as { rating?: RawRatingRow } | null)?.rating;
    if (row) {
      const mapped = rowToRating(row);
      upsertLocal(mapped);
      return { ok: true, rating: mapped };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
