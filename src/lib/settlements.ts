"use client";
import { useSyncExternalStore } from "react";
import type {
  LabSettlement, LabSettlementItem, LabSettlementStatus, Order,
} from "./types";
import {
  MOCK_LAB_SETTLEMENTS, MOCK_LAB_SETTLEMENT_ITEMS, computeOrderLabAmount,
} from "./mock-data";
import { getOrders } from "./store";

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

export function setSettlementStatus(id: string, status: LabSettlementStatus, totalPaid?: number): void {
  _settlements = _settlements.map((s) => s.id === id
    ? { ...s, status, totalPaid: totalPaid ?? (status === "paid" ? s.totalLabAmount : s.totalPaid) }
    : s);
  // Cascade item status when fully paid.
  if (status === "paid") {
    _items = _items.map((i) => i.settlementId === id ? { ...i, status: "paid" } : i);
  }
  emit();
}

export function updateSettlementNotes(id: string, notes: string): void {
  _settlements = _settlements.map((s) => s.id === id ? { ...s, notes } : s);
  emit();
}
