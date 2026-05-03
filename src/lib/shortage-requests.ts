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

// Stage C: nurse shortage requests persist via /api/nurses/[id]/shortage-requests
// when the flag is on. localStorage stays as a write-through cache + offline
// fallback. Per-nurse hydration is opt-in via hydrateShortageRequestsForNurse().

const REQ_KEY   = "makhbartak.shortage.requests.v1";
const ITEMS_KEY = "makhbartak.shortage.items.v1";

let _requests: NurseToolShortageRequest[] = [];
let _items: NurseToolShortageItem[] = [];
let _hydrated = false;

const listeners = new Set<() => void>();
function emit() {
  // Cached snapshots are invalidated on every change so useSyncExternalStore
  // sees a new identity (same pattern as nurse-profile, library stores).
  _reqSnapshot = null;
  _itemsByReqCache.clear();
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  try {
    const r = window.localStorage.getItem(REQ_KEY);
    if (r) _requests = JSON.parse(r) as NurseToolShortageRequest[];
    const i = window.localStorage.getItem(ITEMS_KEY);
    if (i) _items = JSON.parse(i) as NurseToolShortageItem[];
  } catch {}
  emit();
}

function persist() {
  try {
    window.localStorage.setItem(REQ_KEY, JSON.stringify(_requests));
    window.localStorage.setItem(ITEMS_KEY, JSON.stringify(_items));
  } catch {}
}

let _reqSnapshot: NurseToolShortageRequest[] | null = null;
function getRequests(): NurseToolShortageRequest[] {
  if (!_hydrated) hydrate();
  if (_reqSnapshot) return _reqSnapshot;
  _reqSnapshot = _requests;
  return _reqSnapshot;
}
const _serverRequests: NurseToolShortageRequest[] = [];

export function useShortageRequests(): NurseToolShortageRequest[] {
  return useSyncExternalStore(subscribe, getRequests, () => _serverRequests);
}

const _itemsByReqCache = new Map<string, NurseToolShortageItem[]>();
function itemsByReq(requestId: string): NurseToolShortageItem[] {
  if (!_hydrated) hydrate();
  if (_itemsByReqCache.has(requestId)) return _itemsByReqCache.get(requestId)!;
  const list = _items.filter((i) => i.requestId === requestId);
  _itemsByReqCache.set(requestId, list);
  return list;
}
const _serverItems: NurseToolShortageItem[] = [];
export function useShortageItems(requestId: string): NurseToolShortageItem[] {
  return useSyncExternalStore(
    subscribe,
    () => itemsByReq(requestId),
    () => _serverItems,
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

export function submitShortageRequest(input: SubmitInput): NurseToolShortageRequest {
  if (!_hydrated) hydrate();
  const now = new Date().toISOString();
  const id = nextId("nsr");
  const req: NurseToolShortageRequest = {
    id,
    nurseId: input.nurseId,
    nurseName: input.nurseName,
    date: input.date,
    status: "pending",
    note: input.note,
    createdAt: now,
    updatedAt: now,
  };
  const items: NurseToolShortageItem[] = input.items
    .filter((it) => it.requestedQuantity > 0 && it.toolId)
    .map((it) => ({
      id: nextId("nsi"),
      requestId: id,
      toolId: it.toolId,
      toolNameAr: it.toolNameAr,
      requestedQuantity: it.requestedQuantity,
    }));
  _requests = [req, ..._requests];
  _items = [..._items, ...items];
  persist();
  emit();
  // Background persist via API. The local placeholder id (nsr-...) is kept
  // for the optimistic UI; the server's canonical row will land on the next
  // hydrateShortageRequestsForNurse() call.
  void persistShortageSubmitViaApi(input);
  return req;
}

async function persistShortageSubmitViaApi(input: SubmitInput): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(input.nurseId)) return;
  const session: AuthSession | null = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "nurse" && session.role !== "admin")) return;
  await apiSubmitShortageRequest(session, input.nurseId, {
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
}

export function setShortageRequestStatus(
  id: string,
  status: NurseToolShortageStatus,
  adminNote?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!_hydrated) hydrate();
  _requests = _requests.map((r) => r.id === id
    ? { ...r, status, updatedAt: new Date().toISOString(), adminNote: adminNote ?? r.adminNote }
    : r);
  persist();
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
  return apiSetShortageRequestStatus(session, requestId, sqlStatus);
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

  persist();
  emit();
}

export function updateShortageAdminNote(id: string, adminNote: string): void {
  if (!_hydrated) hydrate();
  _requests = _requests.map((r) => r.id === id
    ? { ...r, adminNote, updatedAt: new Date().toISOString() }
    : r);
  persist();
  emit();
}
