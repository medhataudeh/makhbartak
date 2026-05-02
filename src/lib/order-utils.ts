"use client";
import type { Order, Instruction, SystemSettings, TestInstruction, Test } from "./types";
import { MOCK_TESTS, COMMON_INSTRUCTIONS } from "./mock-data";

const COUNTER_KEY = "makhbartak.order-number.counter.v1";
const NUMBER_PREFIX = "HL";

/**
 * Public-facing order number — `HL-YYYY-XXXXXX`. Counter is persisted in
 * localStorage (server-side counter in production). Initial value is the
 * highest number already in use across seeded orders so issued numbers are
 * monotonic across reloads.
 */
export function generateOrderNumber(seedExistingNumbers: string[] = []): string {
  if (typeof window === "undefined") {
    return `${NUMBER_PREFIX}-${new Date().getFullYear()}-000000`;
  }
  let counter = 0;
  try {
    const raw = window.localStorage.getItem(COUNTER_KEY);
    counter = raw ? parseInt(raw, 10) : 0;
    if (Number.isNaN(counter) || counter < 0) counter = 0;
  } catch { /* localStorage blocked */ }

  // Bootstrap from existing seeds the first time we ever generate.
  if (counter === 0 && seedExistingNumbers.length > 0) {
    const max = seedExistingNumbers
      .map(parseSequence)
      .reduce<number>((m, n) => (n != null && n > m ? n : m), 0);
    counter = max;
  }

  counter += 1;
  try { window.localStorage.setItem(COUNTER_KEY, String(counter)); } catch {}
  const year = new Date().getFullYear();
  return `${NUMBER_PREFIX}-${year}-${String(counter).padStart(6, "0")}`;
}

/** Extract the numeric counter from a public number, or null if it's not ours. */
export function parseSequence(publicNumber: string | undefined | null): number | null {
  if (!publicNumber) return null;
  const m = publicNumber.match(/^[A-Z]+-\d{4}-(\d+)$/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/**
 * Customer-friendly order reference. Falls back to the internal id when no
 * `publicNumber` was generated yet (older fixtures).
 */
export function customerOrderRef(order: Order): string {
  return order.publicNumber ?? `#${order.id}`;
}

// ─── Payment gating ────────────────────────────────────────────────────────
// "Actionable" = nurse may see it, admin may assign / progress it.
// Cash orders are actionable when the platform allows cash; online orders
// only become actionable once payment is confirmed (`paid`).
export function isOrderActionable(order: Order, settings: Pick<SystemSettings, "allowCashOrders">): boolean {
  if (order.paymentMethod === "cash") return settings.allowCashOrders;
  return order.paymentStatus === "paid";
}

// ─── Instruction dedup ─────────────────────────────────────────────────────
// Same instruction across multiple tests must render once. Preference order
// for the dedup key:
//   1. TestInstruction.key  — the canonical, admin-curated dedup key.
//   2. id:<id>              — stable per row.
//   3. icon|title|body|text — fallback for ad-hoc rows without ids/keys.
//
// Two overloads cover the legacy customer Instruction shape (icon + textAr)
// and the structured TestInstruction shape (icon + titleAr + bodyAr + key).
export function dedupeInstructions(instructions: Instruction[] | undefined | null): Instruction[];
export function dedupeInstructions(instructions: TestInstruction[] | undefined | null): TestInstruction[];
export function dedupeInstructions(
  instructions: (Instruction | TestInstruction)[] | undefined | null,
): (Instruction | TestInstruction)[] {
  if (!instructions || instructions.length === 0) return [];
  const seen = new Set<string>();
  const out: (Instruction | TestInstruction)[] = [];
  for (const ins of instructions) {
    let key: string;
    const k = (ins as TestInstruction).key;
    if (k) key = `k:${k}`;
    else if (ins.id) key = `id:${ins.id}`;
    else {
      const icon  = ins.icon ?? "";
      const title = (ins as TestInstruction).titleAr ?? "";
      const body  = (ins as TestInstruction).bodyAr  ?? (ins as Instruction).textAr ?? "";
      key = `t:${icon}|${title}|${body}`;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ins);
  }
  // Sort structured instructions by priority when present; legacy instructions
  // keep insertion order.
  return out.sort((a, b) => {
    const pa = (a as TestInstruction).priority;
    const pb = (b as TestInstruction).priority;
    if (typeof pa === "number" && typeof pb === "number") return pa - pb;
    return 0;
  });
}

// ─── Per-order instructions (aggregated + deduped) ─────────────────────────
// Walk the order's items, expand each item to its Test, collect every
// Test.customerInstructions row, and dedupe by `key`. When no item has any
// structured instructions, fall back to the legacy COMMON_INSTRUCTIONS
// (or the order.instructions snapshot).
export function instructionsForOrder(
  order: Order,
  resolveTest: (id: string) => Test | undefined = (id) => MOCK_TESTS.find((t) => t.id === id),
): TestInstruction[] | Instruction[] {
  const collected: TestInstruction[] = [];
  for (const item of order.items) {
    const t = resolveTest(item.testId);
    const rows = (t?.customerInstructions ?? []).filter((i) => i.isActive);
    collected.push(...rows);
  }
  if (collected.length > 0) return dedupeInstructions(collected);
  // Fallbacks (legacy):
  // 1) The order's snapshot instructions (set at create-time).
  // 2) The platform's COMMON_INSTRUCTIONS.
  if (order.instructions && order.instructions.length > 0) {
    return dedupeInstructions(order.instructions);
  }
  return dedupeInstructions(COMMON_INSTRUCTIONS);
}

/** Type guard — narrows an instruction list to the structured shape. */
export function isStructuredInstructions(
  list: TestInstruction[] | Instruction[],
): list is TestInstruction[] {
  return list.length > 0 && (list[0] as TestInstruction).key !== undefined;
}
