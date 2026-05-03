"use client";
import { useSyncExternalStore } from "react";
import type {
  LabSettlement, LabSettlementItem, LabSettlementStatus, Order,
} from "./types";
import {
  MOCK_LAB_SETTLEMENTS, MOCK_LAB_SETTLEMENT_ITEMS, computeOrderLabAmount,
} from "./mock-data";
import { getOrders } from "./store";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";
import {
  apiListSettlements, apiGenerateSettlement, apiSetSettlementStatus,
} from "./lab-api";

let _settlements: LabSettlement[] = [...MOCK_LAB_SETTLEMENTS];
let _items: LabSettlementItem[] = [...MOCK_LAB_SETTLEMENT_ITEMS];
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function nextId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
}

export function getSettlements(): LabSettlement[] { return _settlements; }
export function getSettlementItems(settlementId: string): LabSettlementItem[] {
  return _items.filter((i) => i.settlementId === settlementId);
}

export function useSettlementsForLab(labId: string): LabSettlement[] {
  return useSyncExternalStore(
    subscribe,
    () => _settlements.filter((s) => s.labId === labId),
    () => MOCK_LAB_SETTLEMENTS.filter((s) => s.labId === labId),
  );
}

export function useAllSettlements(): LabSettlement[] {
  return useSyncExternalStore(subscribe, getSettlements, () => MOCK_LAB_SETTLEMENTS);
}

export function useSettlementItems(settlementId: string): LabSettlementItem[] {
  return useSyncExternalStore(
    subscribe,
    () => getSettlementItems(settlementId),
    () => MOCK_LAB_SETTLEMENT_ITEMS.filter((i) => i.settlementId === settlementId),
  );
}

interface GenerateInput {
  labId: string;
  periodStart: string;   // YYYY-MM-DD inclusive
  periodEnd: string;     // YYYY-MM-DD inclusive
  notes?: string;
}

export function generateSettlement(input: GenerateInput): LabSettlement | null {
  const orders = getOrders().filter((o) => isInWindow(o, input));
  if (orders.length === 0) return null;

  const settlementId = nextId("ls");
  const newItems: LabSettlementItem[] = orders.map((o) => ({
    id: nextId("lsi"),
    settlementId,
    orderId: o.id,
    labAmount: computeOrderLabAmount(input.labId, o.items),
    status: "pending",
  }));

  const total = newItems.reduce((s, i) => s + i.labAmount, 0);
  const settlement: LabSettlement = {
    id: settlementId,
    labId: input.labId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    totalOrders: orders.length,
    totalLabAmount: total,
    totalPaid: 0,
    status: "pending",
    notes: input.notes,
    createdAt: new Date().toISOString(),
  };

  _items = [..._items, ...newItems];
  _settlements = [settlement, ..._settlements];
  emit();
  return settlement;
}

function isInWindow(o: Order, input: GenerateInput): boolean {
  if (o.labId !== input.labId) return false;
  // Only completed orders count toward settlement.
  if (o.status !== "completed" && o.status !== "result_ready") return false;
  const visit = o.visitDate;
  return visit >= input.periodStart && visit <= input.periodEnd;
}

export function setSettlementStatus(id: string, status: LabSettlementStatus, totalPaid?: number): Promise<{ ok: boolean; error?: string }> {
  _settlements = _settlements.map((s) => s.id === id
    ? { ...s, status, totalPaid: totalPaid ?? (status === "paid" ? s.totalLabAmount : s.totalPaid) }
    : s);
  // Cascade item status when fully paid.
  if (status === "paid") {
    _items = _items.map((i) => i.settlementId === id ? { ...i, status: "paid" } : i);
  }
  emit();
  return persistSettlementStatusViaApi(id, status, totalPaid);
}

async function persistSettlementStatusViaApi(
  settlementId: string,
  status: LabSettlementStatus,
  totalPaid?: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(settlementId)) return { ok: true };
  const session = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return { ok: true };
  return apiSetSettlementStatus(session, settlementId, status, totalPaid);
}

export function updateSettlementNotes(id: string, notes: string): void {
  _settlements = _settlements.map((s) => s.id === id ? { ...s, notes } : s);
  emit();
}

// Hydrate settlements + items from Supabase for a given lab. Merges by id;
// remote rows win. Safe to call repeatedly on mount.
export async function hydrateSettlementsForLab(labId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(labId)) return;
  const remote = await apiListSettlements(labId);
  if (!remote) return;

  const settlements: LabSettlement[] = remote.map((r) => ({
    id: r.id,
    labId: r.lab_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    totalOrders: r.total_orders,
    totalLabAmount: Number(r.total_lab_amount),
    totalPaid: Number(r.total_paid),
    status: r.status,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  }));
  const items: LabSettlementItem[] = remote.flatMap((r) =>
    r.items.map((it) => ({
      id: it.id,
      settlementId: r.id,
      orderId: it.order_id,
      labAmount: Number(it.lab_amount),
      status: (it.status as LabSettlementStatus) ?? "pending",
    })),
  );

  const sById = new Map(_settlements.map((x) => [x.id, x]));
  for (const s of settlements) sById.set(s.id, s);
  _settlements = Array.from(sById.values()).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

  const iById = new Map(_items.map((x) => [x.id, x]));
  for (const it of items) iById.set(it.id, it);
  _items = Array.from(iById.values());

  emit();
}

// Generate via the server route. The local optimistic generator stays for
// flag-off mock mode; flag-on routes the work server-side and re-hydrates.
export async function generateSettlementRemote(
  labId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ ok: boolean; error?: string; settlementId?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(labId)) return { ok: false, error: "lab not in supabase" };
  const session = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return { ok: false, error: "admin only" };
  const result = await apiGenerateSettlement(session, labId, periodStart, periodEnd);
  if (!result.ok) return result;
  await hydrateSettlementsForLab(labId);
  return result;
}
