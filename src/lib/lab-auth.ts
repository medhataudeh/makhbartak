"use client";
import { useSyncExternalStore } from "react";
import type { LabUser } from "./types";
import { MOCK_LAB_USERS } from "./mock-data";

const USERS_KEY = "makhbartak.lab-users.v1";
const SESSION_KEY = "makhbartak.lab.session.v2";

// ─── Lab users (mutable list, admin-managed) ────────────────────────────────
let _users: LabUser[] = [...MOCK_LAB_USERS];
let _hydratedUsers = false;
const userListeners = new Set<() => void>();
function emitUsers() { userListeners.forEach((l) => l()); }
function subscribeUsers(l: () => void) { userListeners.add(l); return () => { userListeners.delete(l); }; }

function hydrateUsers() {
  if (_hydratedUsers || typeof window === "undefined") return;
  _hydratedUsers = true;
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    if (raw) {
      const overrides = JSON.parse(raw) as LabUser[];
      const byId = new Map(overrides.map((u) => [u.id, u]));
      _users = MOCK_LAB_USERS
        .map((u) => byId.get(u.id) ?? u)
        .concat(overrides.filter((u) => !MOCK_LAB_USERS.find((m) => m.id === u.id)));
    }
  } catch {}
  emitUsers();
}

function persistUsers() {
  try { window.localStorage.setItem(USERS_KEY, JSON.stringify(_users)); } catch {}
}

export function getLabUsers(): LabUser[] {
  if (!_hydratedUsers) hydrateUsers();
  return _users;
}

export function useLabUsers(): LabUser[] {
  return useSyncExternalStore(subscribeUsers, getLabUsers, () => MOCK_LAB_USERS);
}

export function upsertLabUser(user: LabUser): void {
  const exists = _users.find((u) => u.id === user.id);
  _users = exists ? _users.map((u) => u.id === user.id ? user : u) : [..._users, user];
  persistUsers();
  emitUsers();
}

export function deleteLabUser(id: string): void {
  _users = _users.filter((u) => u.id !== id);
  persistUsers();
  emitUsers();
}

export function setLabUserActive(id: string, isActive: boolean): void {
  _users = _users.map((u) => u.id === id ? { ...u, isActive } : u);
  persistUsers();
  emitUsers();
}

export function resetLabUserPassword(id: string, newPassword: string): void {
  _users = _users.map((u) => u.id === id ? { ...u, password: newPassword } : u);
  persistUsers();
  emitUsers();
}

// ─── Auth ───────────────────────────────────────────────────────────────────
export interface LabSession {
  userId: string;
  labId: string;
  username: string;
  fullName: string;
  role: LabUser["role"];
}

export function loginLabUser(username: string, password: string): LabSession | null {
  const u = getLabUsers().find(
    (x) => x.isActive && x.username.toLowerCase() === username.trim().toLowerCase() && x.password === password,
  );
  if (!u) return null;
  // Stamp last login.
  upsertLabUser({ ...u, lastLoginAt: new Date().toISOString() });
  const session: LabSession = {
    userId: u.id, labId: u.labId, username: u.username, fullName: u.fullName, role: u.role,
  };
  try { window.localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  return session;
}

export function logoutLabUser(): void {
  try { window.localStorage.removeItem(SESSION_KEY); } catch {}
}

export function getStoredLabSession(): LabSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as LabSession;
    // Validate against current user list — admin may have deactivated.
    const u = getLabUsers().find((x) => x.id === session.userId && x.isActive);
    return u ? session : null;
  } catch {
    return null;
  }
}
