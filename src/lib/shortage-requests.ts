"use client";
import { useSyncExternalStore } from "react";
import type {
  NurseToolShortageRequest, NurseToolShortageItem, NurseToolShortageStatus,
} from "./types";

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
  return req;
}

export function setShortageRequestStatus(
  id: string,
  status: NurseToolShortageStatus,
  adminNote?: string,
): void {
  if (!_hydrated) hydrate();
  _requests = _requests.map((r) => r.id === id
    ? { ...r, status, updatedAt: new Date().toISOString(), adminNote: adminNote ?? r.adminNote }
    : r);
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
