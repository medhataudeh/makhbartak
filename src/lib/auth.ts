"use client";
import { useSyncExternalStore } from "react";
import type {
  AdminUser, AuthSession, AuthUser, LabUser, Nurse, Role,
} from "./types";
import {
  MOCK_ADMINS, MOCK_CUSTOMER_USERS, MOCK_LAB_USERS, MOCK_NURSES,
  MOCK_NURSE_USERS,
} from "./mock-data";

// One unified credential store fronts four role tables. Admin and lab keep
// their richer entity types (AdminRole, LabUserRole, labId) and CRUD writes
// through to those; customers and nurses live as AuthUser since they have
// no extra credential-bearing fields.

const SESSION_KEY = "makhbartak.session.v1";
const CUSTOMERS_KEY = "makhbartak.auth.customers.v1";
const NURSES_KEY = "makhbartak.auth.nurses.v1";
const ADMINS_KEY = "makhbartak.auth.admins.v1";
const LAB_USERS_KEY = "makhbartak.auth.lab-users.v1";

// ─── Generic mutable+persisted list helper ──────────────────────────────────
function makeStore<T extends { id: string }>(key: string, seed: T[]) {
  let list: T[] = [...seed];
  let hydrated = false;
  const ls = new Set<() => void>();
  const emit = () => ls.forEach((l) => l());
  const subscribe = (l: () => void) => { ls.add(l); return () => { ls.delete(l); }; };
  const hydrate = () => {
    if (hydrated || typeof window === "undefined") return;
    hydrated = true;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const overrides = JSON.parse(raw) as T[];
        const byId = new Map(overrides.map((u) => [u.id, u]));
        list = seed
          .map((u) => byId.get(u.id) ?? u)
          .concat(overrides.filter((o) => !seed.find((s) => s.id === o.id)));
      }
    } catch {}
    emit();
  };
  const persist = () => {
    try { window.localStorage.setItem(key, JSON.stringify(list)); } catch {}
  };
  return {
    get(): T[] { if (!hydrated) hydrate(); return list; },
    subscribe,
    initial: [...seed] as T[],
    upsert(item: T) {
      if (!hydrated) hydrate();
      const exists = list.find((u) => u.id === item.id);
      list = exists ? list.map((u) => u.id === item.id ? item : u) : [...list, item];
      persist();
      emit();
    },
    remove(id: string) {
      if (!hydrated) hydrate();
      list = list.filter((u) => u.id !== id);
      persist();
      emit();
    },
    patch(id: string, patch: Partial<T>) {
      if (!hydrated) hydrate();
      list = list.map((u) => u.id === id ? { ...u, ...patch } : u);
      persist();
      emit();
    },
  };
}

// ─── Per-role stores ────────────────────────────────────────────────────────
const customers = makeStore<AuthUser>(CUSTOMERS_KEY, MOCK_CUSTOMER_USERS);
const nurses = makeStore<AuthUser>(NURSES_KEY, MOCK_NURSE_USERS);
const admins = makeStore<AdminUser>(ADMINS_KEY, MOCK_ADMINS);
const labUsers = makeStore<LabUser>(LAB_USERS_KEY, MOCK_LAB_USERS);

// Customers
export const getCustomerUsers = customers.get;
export function useCustomerUsers(): AuthUser[] {
  return useSyncExternalStore(customers.subscribe, customers.get, () => customers.initial);
}
export const upsertCustomerUser = customers.upsert;
export const deleteCustomerUser = customers.remove;
export function setCustomerUserActive(id: string, isActive: boolean) { customers.patch(id, { isActive }); }
export function resetCustomerUserPassword(id: string, password: string) { customers.patch(id, { password }); }

// Nurses
export const getNurseUsers = nurses.get;
export function useNurseUsers(): AuthUser[] {
  return useSyncExternalStore(nurses.subscribe, nurses.get, () => nurses.initial);
}
export const upsertNurseUser = nurses.upsert;
export const deleteNurseUser = nurses.remove;
export function setNurseUserActive(id: string, isActive: boolean) { nurses.patch(id, { isActive }); }
export function resetNurseUserPassword(id: string, password: string) { nurses.patch(id, { password }); }

// Admins
export const getAdmins = admins.get;
export function useAdmins(): AdminUser[] {
  return useSyncExternalStore(admins.subscribe, admins.get, () => admins.initial);
}
export const upsertAdmin = admins.upsert;
export const deleteAdmin = admins.remove;
export function setAdminActive(id: string, isActive: boolean) { admins.patch(id, { isActive }); }
export function resetAdminPassword(id: string, password: string) { admins.patch(id, { password }); }

// Lab users (replaces the old lib/lab-auth.ts API)
export const getLabUsers = labUsers.get;
export function useLabUsers(): LabUser[] {
  return useSyncExternalStore(labUsers.subscribe, labUsers.get, () => labUsers.initial);
}
export const upsertLabUser = labUsers.upsert;
export const deleteLabUser = labUsers.remove;
export function setLabUserActive(id: string, isActive: boolean) { labUsers.patch(id, { isActive }); }
export function resetLabUserPassword(id: string, password: string) { labUsers.patch(id, { password }); }

// ─── Login / logout / session ───────────────────────────────────────────────
export interface LoginResult {
  ok: boolean;
  session?: AuthSession;
  error?: "invalid" | "inactive";
}

const sessionListeners = new Set<() => void>();
// Cached parsed session — read once from localStorage on first access, then
// updated only on login/logout/storage events. This is required for
// useSyncExternalStore's getSnapshot to return a stable reference between
// renders (React bails out of re-renders by reference equality).
let _cachedSession: AuthSession | null = null;
let _sessionHydrated = false;

function readSessionFromStorage(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function refreshCachedSession() {
  _cachedSession = readSessionFromStorage();
  _sessionHydrated = true;
}

function ensureSessionHydrated() {
  if (!_sessionHydrated) refreshCachedSession();
}

function emitSession() {
  refreshCachedSession();
  sessionListeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  // Cross-tab sync for logout.
  window.addEventListener("storage", (e) => {
    if (e.key === SESSION_KEY) emitSession();
  });
}

function subscribeSession(l: () => void) {
  sessionListeners.add(l);
  return () => { sessionListeners.delete(l); };
}

function matchUsername(a: string, b: string) {
  return a.toLowerCase() === b.trim().toLowerCase();
}

interface LookupHit {
  user: { id: string; username: string; password: string; isActive: boolean };
  session: AuthSession;
  stamp: () => void;
}

function lookup(username: string): LookupHit[] {
  const hits: LookupHit[] = [];
  for (const u of getCustomerUsers()) {
    if (matchUsername(u.username, username)) hits.push({
      user: u,
      session: { userId: u.id, username: u.username, name: u.name, role: "customer", linkedEntityId: u.linkedEntityId },
      stamp: () => customers.patch(u.id, { lastLoginAt: new Date().toISOString() }),
    });
  }
  for (const u of getNurseUsers()) {
    if (matchUsername(u.username, username)) hits.push({
      user: u,
      session: { userId: u.id, username: u.username, name: u.name, role: "nurse", linkedEntityId: u.linkedEntityId },
      stamp: () => nurses.patch(u.id, { lastLoginAt: new Date().toISOString() }),
    });
  }
  for (const a of getAdmins()) {
    if (matchUsername(a.username, username)) hits.push({
      user: a,
      session: { userId: `admin:${a.id}`, username: a.username, name: a.name, role: "admin", linkedEntityId: a.id },
      stamp: () => admins.patch(a.id, { lastLogin: new Date().toISOString() }),
    });
  }
  for (const l of getLabUsers()) {
    if (matchUsername(l.username, username)) hits.push({
      user: l,
      session: { userId: `lab:${l.id}`, username: l.username, name: l.fullName, role: "lab", linkedEntityId: l.id },
      stamp: () => labUsers.patch(l.id, { lastLoginAt: new Date().toISOString() }),
    });
  }
  return hits;
}

export function loginUser(username: string, password: string): LoginResult {
  const hits = lookup(username);
  if (hits.length === 0) return { ok: false, error: "invalid" };
  const hit = hits.find((h) => h.user.password === password);
  if (!hit) return { ok: false, error: "invalid" };
  if (!hit.user.isActive) return { ok: false, error: "inactive" };
  hit.stamp();
  try { window.localStorage.setItem(SESSION_KEY, JSON.stringify(hit.session)); } catch {}
  emitSession();
  return { ok: true, session: hit.session };
}

export function logout(): void {
  try { window.localStorage.removeItem(SESSION_KEY); } catch {}
  emitSession();
}

export function getStoredSession(): AuthSession | null {
  ensureSessionHydrated();
  const session = _cachedSession;
  if (!session) return null;
  // Re-validate: an admin may have deactivated this user since last login.
  const stillActive = (() => {
    switch (session.role) {
      case "customer": return getCustomerUsers().some((u) => u.id === session.userId && u.isActive);
      case "nurse":    return getNurseUsers().some((u) => u.id === session.userId && u.isActive);
      case "admin":    return getAdmins().some((a) => a.id === session.linkedEntityId && a.isActive);
      case "lab":      return getLabUsers().some((u) => u.id === session.linkedEntityId && u.isActive);
    }
  })();
  return stillActive ? session : null;
}

export function useSession(): AuthSession | null {
  return useSyncExternalStore(subscribeSession, getStoredSession, () => null);
}

// ─── Resolvers ──────────────────────────────────────────────────────────────
export function hasRole(session: AuthSession | null, role: Role): boolean {
  return !!session && session.role === role;
}

export function nurseFromSession(session: AuthSession | null): Nurse | null {
  if (!session || session.role !== "nurse") return null;
  return MOCK_NURSES.find((n) => n.id === session.linkedEntityId) ?? null;
}

export function labUserFromSession(session: AuthSession | null): LabUser | null {
  if (!session || session.role !== "lab") return null;
  return getLabUsers().find((u) => u.id === session.linkedEntityId) ?? null;
}

export function adminFromSession(session: AuthSession | null): AdminUser | null {
  if (!session || session.role !== "admin") return null;
  return getAdmins().find((a) => a.id === session.linkedEntityId) ?? null;
}
