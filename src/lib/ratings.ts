"use client";
import { useSyncExternalStore } from "react";
import type { OrderRating } from "./types";
import { MOCK_ORDER_RATINGS } from "./mock-data";

let _ratings: OrderRating[] = [...MOCK_ORDER_RATINGS];
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function nextId() {
  return `rt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
}

export function getRatings(): OrderRating[] { return _ratings; }
export function getRatingForOrder(orderId: string): OrderRating | null {
  return _ratings.find((r) => r.orderId === orderId) ?? null;
}

export function useOrderRating(orderId: string): OrderRating | null {
  return useSyncExternalStore(
    subscribe,
    () => getRatingForOrder(orderId),
    () => MOCK_ORDER_RATINGS.find((r) => r.orderId === orderId) ?? null,
  );
}

export function useAllRatings(): OrderRating[] {
  return useSyncExternalStore(subscribe, getRatings, () => MOCK_ORDER_RATINGS);
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

export function submitOrderRating(input: SubmitInput): OrderRating {
  // One rating per order — replace if already submitted.
  const existing = _ratings.find((r) => r.orderId === input.orderId);
  if (existing) {
    const next: OrderRating = { ...existing, ...input, createdAt: new Date().toISOString() };
    _ratings = _ratings.map((r) => r.id === existing.id ? next : r);
    emit();
    return next;
  }
  const created: OrderRating = {
    id: nextId(),
    ...input,
    createdAt: new Date().toISOString(),
  };
  _ratings = [created, ..._ratings];
  emit();
  return created;
}
