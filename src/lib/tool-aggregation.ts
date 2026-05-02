"use client";
import type {
  Order, Test, LibraryTool, NurseChecklistDefaults, TestToolReq,
} from "./types";
import { MOCK_TESTS } from "./mock-data";

/** Resolved checklist row — what the nurse actually ticks off in the morning. */
export interface AggregatedTool {
  toolId: string;
  /** Display name from the LibraryTool catalog. */
  nameAr: string;
  /** Display unit from the LibraryTool catalog. */
  unit: string;
  /** Quantity AFTER buffer is applied. */
  qty: number;
  /** Raw quantity BEFORE the buffer (useful for admin tooltips). */
  qtyRaw: number;
  /** True when at least one contributing test marked the tool required, OR the
   *  tool came in via NurseChecklistDefaults.defaultToolIds. */
  required: boolean;
  /** Notes collected from contributing tests, deduped. */
  notes: string[];
  /** Tests that contributed to this tool (for traceability). */
  fromTestIds: string[];
}

interface AggregateInput {
  orders: Order[];
  defaults: NurseChecklistDefaults;
  toolsCatalog: LibraryTool[];
  /** Optional override for resolving Test by id. Defaults to MOCK_TESTS. */
  resolveTest?: (id: string) => Test | undefined;
}

/**
 * Aggregate nurse tools across all orders for a day.
 *
 * Walks each order's items (which expand package children — packages already
 * unfold to per-test order items at order-creation time), resolves each item's
 * `Test.nurseTools`, and sums quantities by toolId. Required-flag is OR'd
 * across contributors; notes are deduped. Defaults are added with qty 0+
 * (treated as required regardless of order content). The buffer percent is
 * applied to the final summed qty (round up to never under-stock).
 */
export function aggregateNurseTools({
  orders, defaults, toolsCatalog, resolveTest,
}: AggregateInput): AggregatedTool[] {
  const lookup = (id: string) => (resolveTest ?? defaultResolve)(id);
  const acc = new Map<string, {
    raw: number; required: boolean; notes: Set<string>; fromTestIds: Set<string>;
  }>();

  const ensure = (toolId: string) => {
    if (!acc.has(toolId)) acc.set(toolId, { raw: 0, required: false, notes: new Set(), fromTestIds: new Set() });
    return acc.get(toolId)!;
  };

  // Walk every order item.
  for (const o of orders) {
    for (const item of o.items) {
      const t = lookup(item.testId);
      const reqs: TestToolReq[] = t?.nurseTools ?? [];
      for (const r of reqs) {
        const slot = ensure(r.toolId);
        slot.raw += r.quantityPerTest;
        if (r.required) slot.required = true;
        if (r.note) slot.notes.add(r.note);
        if (t?.id) slot.fromTestIds.add(t.id);
      }
    }
  }

  // Defaults — ensure they appear even if no test referenced them. Marked
  // required by definition.
  for (const id of defaults.defaultToolIds) {
    const slot = ensure(id);
    slot.required = true;
  }

  const buffer = Math.max(0, defaults.bufferPct) / 100;

  const out: AggregatedTool[] = [];
  for (const [toolId, slot] of acc.entries()) {
    const cat = toolsCatalog.find((c) => c.id === toolId);
    if (!cat || !cat.isActive) continue;
    const qtyBuffered = slot.raw === 0 ? 0 : Math.ceil(slot.raw * (1 + buffer));
    out.push({
      toolId,
      nameAr: cat.nameAr,
      unit:   cat.unit,
      qty:    qtyBuffered,
      qtyRaw: slot.raw,
      required: slot.required,
      notes:  Array.from(slot.notes),
      fromTestIds: Array.from(slot.fromTestIds),
    });
  }

  // Required first, then by name.
  out.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.nameAr.localeCompare(b.nameAr, "ar");
  });
  return out;
}

function defaultResolve(id: string): Test | undefined {
  return MOCK_TESTS.find((t) => t.id === id);
}
