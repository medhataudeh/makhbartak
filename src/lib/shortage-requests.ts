"use client";
import { useSyncExternalStore } from "react";
import type {
  AuthSession, NurseToolShortageRequest, NurseToolShortageItem, NurseToolShortageStatus,
} from "./types";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";
import {
  apiSubmitShortageRequest, apiSetShortageRequestStatus, apiListShortageRequests,
} from "./nurse-api";

// Phase 3: nurse shortage requests live in Supabase. The local store is a
// per-tab cache populated by hydrateShortageRequestsForNurse; localStorage
// has been removed as a source of truth so a stale device can't keep
// pretending a request was filed.

let _requests: NurseToolShortageRequest[] = [];
let _items: NurseToolShortageItem[] = [];

const listeners = new Set<() => void>();
function emit() {
  _reqSnapshot = null;
  _itemsByReqCache.clear();
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

let _reqSnapshot: NurseToolShortageRequest[] | null = null;
function getRequests(): NurseToolShortageRequest[] {
  if (_reqSnapshot) return _reqSnapshot;
  _reqSnapshot = _requests;
  return _reqSnapshot;
}

export function useShortageRequests(): NurseToolShortageRequest[] {
  return useSyncExternalStore(subscribe, getRequests, () => []);
}

const _itemsByReqCache = new Map<string, NurseToolShortageItem[]>();
function itemsByReq(requestId: string): NurseToolShortageItem[] {
  if (_itemsByReqCache.has(requestId)) return _itemsByReqCache.get(requestId)!;
  const list = _items.filter((i) => i.requestId === requestId);
  _itemsByReqCache.set(requestId, list);
  return list;
}
export function useShortageItems(requestId: string): NurseToolShortageItem[] {
  return useSyncExternalStore(
    subscribe,
    () => itemsByReq(requestId),
    () => [],
  );
}

interface SubmitInput {
  nurseId: string;
  nurseName?: string;
  date: string;
  note?: string;
  items: { toolId: string; toolNameAr?: string; requestedQuantity: number }[];
}

function nextId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
}

// FINAL HARDENING (P1): submission is awaited end-to-end. Optimistic local
// row is rolled back on server failure so admin never sees a request that
// only exists on one device. On success we replace the placeholder id
// with the canonical UUID returned by the server, then re-hydrate so any
// server-side derived fields (timestamps, nurseName) match the DB.
export async function submitShortageRequest(input: SubmitInput): Promise<{
  ok: boolean;
  error?: string;
  request?: NurseToolShortageRequest;
}> {
  const now = new Date().toISOString();
  const localId = nextId("nsr");
  const req: NurseToolShortageRequest = {
    id: localId,
    nurseId: input.nurseId,
    nurseName: input.nurseName,
    date: input.date,
    status: "pending",
    note: input.note,
    createdAt: now,
    updatedAt: now,
  };
  const localItems: NurseToolShortageItem[] = input.items
    .filter((it) => it.requestedQuantity > 0 && it.toolId)
    .map((it) => ({
      id: nextId("nsi"),
      requestId: localId,
      toolId: it.toolId,
      toolNameAr: it.toolNameAr,
      requestedQuantity: it.requestedQuantity,
    }));
  _requests = [req, ..._requests];
  _items = [..._items, ...localItems];
  emit();

  // Flag-off / non-uuid: legacy in-memory only — accept the local row.
  if (!USE_SUPABASE || !isUuid(input.nurseId)) {
    return { ok: true, request: req };
  }
  const session: AuthSession | null = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "nurse" && session.role !== "admin")) {
    rollbackLocal(localId);
    return { ok: false, error: "الجلسة غير صالحة" };
  }

  const result = await apiSubmitShortageRequest(input.nurseId, {
    day: input.date,
    note: input.note,
    items: input.items
      .filter((it) => it.requestedQuantity > 0)
      .map((it) => ({
        toolId: it.toolId || null,
        nameSnapshot: it.toolNameAr ?? it.toolId ?? "—",
        quantity: it.requestedQuantity,
      })),
  });
  if (!result.ok) {
    console.error("[api/nurses/shortage-requests] submit failed", { nurseId: input.nurseId, error: result.error });
    rollbackLocal(localId);
    return { ok: false, error: result.error || "تعذر إرسال طلب الأدوات، حاول مرة أخرى" };
  }

  // Replace the placeholder id with the canonical UUID so admin and nurse
  // views agree on identity. A follow-up hydrate fills in any server-side
  // timestamps and nurseName.
  if (result.requestId) {
    _requests = _requests.map((r) =>
      r.id === localId ? { ...r, id: result.requestId! } : r,
    );
    _items = _items.map((i) =>
      i.requestId === localId ? { ...i, requestId: result.requestId! } : i,
    );
    emit();
  }
  void hydrateShortageRequestsForNurse(input.nurseId);
  return {
    ok: true,
    request: result.requestId ? { ...req, id: result.requestId } : req,
  };
}

function rollbackLocal(localId: string) {
  _requests = _requests.filter((r) => r.id !== localId);
  _items = _items.filter((i) => i.requestId !== localId);
  emit();
}

export function setShortageRequestStatus(
  id: string,
  status: NurseToolShortageStatus,
  adminNote?: string,
): Promise<{ ok: boolean; error?: string }> {
  _requests = _requests.map((r) => r.id === id
    ? { ...r, status, updatedAt: new Date().toISOString(), adminNote: adminNote ?? r.adminNote }
    : r);
  emit();
  return persistShortageStatusViaApi(id, status);
}

async function persistShortageStatusViaApi(
  requestId: string,
  status: NurseToolShortageStatus,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(requestId)) return { ok: true };
  const session: AuthSession | null = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return { ok: true };
  // The store uses an extended status union; the server enum has only three
  // values. Map preparing/sent → "acknowledged", resolved/cancelled → "resolved".
  const sqlStatus: "pending" | "acknowledged" | "resolved" =
    status === "preparing" || status === "sent" ? "acknowledged" :
    status === "resolved" || status === "cancelled" ? "resolved" :
    "pending";
  return apiSetShortageRequestStatus(requestId, sqlStatus);
}

// Pull this nurse's shortage requests from Supabase and merge into the local
// store. No-op when the flag is off or the nurse has a non-uuid linked id.
export async function hydrateShortageRequestsForNurse(nurseId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(nurseId)) return;
  const remote = await apiListShortageRequests(nurseId);
  if (!remote) return;

  // Convert API shape to the store's NurseToolShortageRequest + items shape.
  const mappedReqs: NurseToolShortageRequest[] = remote.map((r) => ({
    id: r.id,
    nurseId: r.nurseId,
    nurseName: r.nurseName ?? undefined,
    date: r.day,
    status: r.status as NurseToolShortageStatus,
    note: r.note ?? undefined,
    adminNote: undefined,
    createdAt: r.createdAt,
    updatedAt: r.resolvedAt ?? r.createdAt,
  }));
  const mappedItems: NurseToolShortageItem[] = remote.flatMap((r) =>
    r.items.map((it) => ({
      id: it.id,
      requestId: r.id,
      toolId: it.toolId ?? "",
      toolNameAr: it.nameSnapshot,
      requestedQuantity: it.quantity,
    })),
  );

  // Merge by id; remote wins.
  const reqById = new Map(_requests.map((x) => [x.id, x]));
  for (const r of mappedReqs) reqById.set(r.id, r);
  _requests = Array.from(reqById.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const itemById = new Map(_items.map((x) => [x.id, x]));
  for (const it of mappedItems) itemById.set(it.id, it);
  _items = Array.from(itemById.values());

  emit();
}

export function updateShortageAdminNote(id: string, adminNote: string): void {
  _requests = _requests.map((r) => r.id === id
    ? { ...r, adminNote, updatedAt: new Date().toISOString() }
    : r);
  emit();
}
