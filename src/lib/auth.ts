"use client";
import { useSyncExternalStore } from "react";
import { getSupabaseBrowser } from "./supabase/client";
import type { AuthSession, Role } from "./types";

// Phase 8: Real Supabase Auth is the source of truth. Email + password via
// supabase.auth.signInWithPassword. Session shape stays compatible with
// every legacy caller (userId / username / name / role / linkedEntityId)
// plus role-specific extras (customerId / nurseId / labUserId / labId /
// labRole / adminRole) populated server-side by /api/me.
//
// useSession() subscribes to supabase.auth.onAuthStateChange and refetches
// the enriched session from /api/me whenever the auth state flips. The
// cached session lives in module-local memory; localStorage is no longer
// involved in operational auth.

let _cachedSession: AuthSession | null = null;
let _hydrating: Promise<AuthSession | null> | null = null;
const sessionListeners = new Set<() => void>();
function emitSession() { sessionListeners.forEach((l) => l()); }

async function fetchEnrichedSession(): Promise<AuthSession | null> {
  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const r = body?.session;
    if (!r) return null;
    const session: AuthSession = {
      userId: r.userId,
      username: r.email ?? "",
      name: r.fullName ?? "",
      role: r.role as Role,
      linkedEntityId:
        r.role === "customer" ? (r.customerId ?? r.userId) :
        r.role === "nurse"    ? (r.nurseId ?? r.userId) :
        r.role === "lab"      ? (r.labUserId ?? r.userId) :
        r.userId,
      customerId: r.customerId ?? undefined,
      nurseId: r.nurseId ?? undefined,
      labUserId: r.labUserId ?? undefined,
      labId: r.labId ?? undefined,
      labRole: r.labRole ?? undefined,
      adminRole: r.adminRole ?? undefined,
    };
    return session;
  } catch {
    return null;
  }
}

async function refreshSession(): Promise<void> {
  if (_hydrating) { await _hydrating; return; }
  _hydrating = fetchEnrichedSession();
  try {
    const next = await _hydrating;
    _cachedSession = next;
  } finally {
    _hydrating = null;
    emitSession();
  }
}

let _wired = false;
function ensureAuthListenerWired() {
  if (_wired || typeof window === "undefined") return;
  _wired = true;
  const sb = getSupabaseBrowser();
  if (!sb) {
    // Env vars missing — flag-off mock mode (no real auth available).
    emitSession();
    return;
  }
  // First fetch: populate the cache from the cookie.
  void refreshSession();
  // Cross-tab sign-in/sign-out + token refresh propagate via this listener.
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      _cachedSession = null;
      emitSession();
      return;
    }
    void refreshSession();
  });
}

function subscribeSession(l: () => void) {
  ensureAuthListenerWired();
  sessionListeners.add(l);
  return () => { sessionListeners.delete(l); };
}

export function getStoredSession(): AuthSession | null {
  ensureAuthListenerWired();
  return _cachedSession;
}

export function useSession(): AuthSession | null {
  return useSyncExternalStore(subscribeSession, getStoredSession, () => null);
}

export interface LoginResult {
  ok: boolean;
  session?: AuthSession;
  error?: string;
}

export async function loginUser(
  email: string,
  password: string,
  opts?: { allowedRoles?: Role[] },
): Promise<LoginResult> {
  const sb = getSupabaseBrowser();
  if (!sb) return { ok: false, error: "Supabase client not configured" };
  const { error } = await sb.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    const msg = error.message?.toLowerCase().includes("invalid")
      ? "اسم المستخدم أو كلمة المرور غير صحيحة"
      : error.message ?? "تعذر تسجيل الدخول";
    return { ok: false, error: msg };
  }
  // Pull the enriched session and confirm role.
  const next = await fetchEnrichedSession();
  if (!next) {
    await sb.auth.signOut().catch(() => {});
    return { ok: false, error: "تعذر تحميل بيانات الجلسة" };
  }
  if (opts?.allowedRoles && !opts.allowedRoles.includes(next.role)) {
    await sb.auth.signOut().catch(() => {});
    _cachedSession = null;
    emitSession();
    return {
      ok: false,
      error: "لا تملك صلاحية الوصول إلى هذه المنصة بهذا الحساب.",
    };
  }
  _cachedSession = next;
  emitSession();
  return { ok: true, session: next };
}

export async function logout(): Promise<void> {
  const sb = getSupabaseBrowser();
  if (sb) await sb.auth.signOut().catch(() => {});
  _cachedSession = null;
  emitSession();
}

// ─── Role helpers (kept for callers) ───────────────────────────────────────
export function hasRole(session: AuthSession | null, role: Role): boolean {
  return !!session && session.role === role;
}

import { MOCK_NURSES } from "./mock-data";
import type { Nurse, LabUser, AdminUser, AuthUser } from "./types";
import {
  fetchAdminUsers, fetchCustomerUsers, fetchNurseUsers, fetchLabUsers,
  apiCreateUser, apiPatchUser, apiDeleteUser, apiResetUserPassword,
} from "./admin-users-api";

// Phase 8 — nurse seed metadata (photo, city) is still in MOCK_NURSES until
// nurse rows in Supabase carry photo_url. Real auth still gates routing; this
// helper just enriches the session view.
export function nurseFromSession(session: AuthSession | null): Nurse | null {
  if (!session || session.role !== "nurse") return null;
  const id = session.nurseId ?? session.linkedEntityId;
  return MOCK_NURSES.find((n) => n.id === id) ?? null;
}

export function labUserFromSession(session: AuthSession | null): LabUser | null {
  if (!session || session.role !== "lab") return null;
  // Synthesize a LabUser from session fields rather than looking up a mock row.
  return {
    id: session.labUserId ?? "",
    username: session.username,
    password: "",
    fullName: session.name,
    labId: session.labId ?? "",
    role: session.labRole ?? "lab_admin",
    isActive: true,
  };
}

export function adminFromSession(session: AuthSession | null): AdminUser | null {
  if (!session || session.role !== "admin") return null;
  return {
    id: session.userId,
    username: session.username,
    password: "",
    name: session.name || session.username,
    role: session.adminRole ?? "super_admin",
    isActive: true,
  };
}

// ─── Phase 8.5 admin user CRUD — Supabase-backed ──────────────────────────
// AdminDashboard sub-sections call useAdmins / useCustomerUsers / useNurseUsers
// / useLabUsers as plain hooks, plus upsert / delete / setActive / reset
// mutators. We back each list with a tiny reactive cache that hydrates on
// first use and on every successful mutation.

function makeListStore<T>(fetcher: () => Promise<T[]>) {
  let _items: T[] = [];
  let _hydrated = false;
  let _hydrating = false;
  const ls = new Set<() => void>();
  const emit = () => ls.forEach((l) => l());
  const subscribe = (l: () => void) => {
    ls.add(l);
    if (!_hydrated && !_hydrating) {
      _hydrating = true;
      void fetcher().then((rows) => {
        _items = rows;
        _hydrated = true;
        _hydrating = false;
        emit();
      });
    }
    return () => { ls.delete(l); };
  };
  const get = () => _items;
  return {
    use(): T[] {
      return useSyncExternalStore(subscribe, get, () => []);
    },
    async refresh(): Promise<void> {
      const next = await fetcher();
      _items = next;
      _hydrated = true;
      emit();
    },
  };
}

const adminStore     = makeListStore<AdminUser>(fetchAdminUsers);
const customerStore  = makeListStore<AuthUser>(fetchCustomerUsers);
const nurseStore     = makeListStore<AuthUser>(fetchNurseUsers);
const labUserStore   = makeListStore<LabUser>(fetchLabUsers);

export const useAdmins        = () => adminStore.use();
export const useCustomerUsers = () => customerStore.use();
export const useNurseUsers    = () => nurseStore.use();
export const useLabUsers      = () => labUserStore.use();

// Upsert mutators — translate the AuthUser/AdminUser/LabUser shape into the
// payload the /api/admin/users routes expect. New rows (id missing) hit POST;
// existing rows hit PATCH. Password is optional on PATCH; if present, callers
// should use resetXxxPassword instead.
export async function upsertAdmin(a: AdminUser): Promise<{ ok: boolean; error?: string }> {
  const isCreate = !a.id;
  const result = isCreate
    ? await apiCreateUser({
        role: "admin",
        email: a.username,
        password: a.password || "phase8-admin-temp-password",
        fullName: a.name,
        adminRole: a.role,
        isActive: a.isActive,
      })
    : await apiPatchUser(a.id, {
        fullName: a.name,
        adminRole: a.role,
        isActive: a.isActive,
      });
  if (result.ok) await adminStore.refresh();
  return result;
}

export async function deleteAdmin(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await apiDeleteUser(id);
  if (result.ok) await adminStore.refresh();
  return result;
}

export async function setAdminActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const result = await apiPatchUser(id, { isActive });
  if (result.ok) await adminStore.refresh();
  return result;
}

export async function resetAdminPassword(id: string, password: string): Promise<{ ok: boolean; error?: string }> {
  return apiResetUserPassword(id, password);
}

export async function upsertCustomerUser(u: AuthUser): Promise<{ ok: boolean; error?: string }> {
  const isCreate = !u.id;
  const result = isCreate
    ? await apiCreateUser({
        role: "customer",
        email: u.username,
        password: u.password || "phase8-customer-temp-password",
        fullName: u.name,
        isActive: u.isActive,
      })
    : await apiPatchUser(u.id, { fullName: u.name, isActive: u.isActive });
  if (result.ok) await customerStore.refresh();
  return result;
}

export async function deleteCustomerUser(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await apiDeleteUser(id);
  if (result.ok) await customerStore.refresh();
  return result;
}

export async function setCustomerUserActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const result = await apiPatchUser(id, { isActive });
  if (result.ok) await customerStore.refresh();
  return result;
}

export async function resetCustomerUserPassword(id: string, password: string): Promise<{ ok: boolean; error?: string }> {
  return apiResetUserPassword(id, password);
}

export async function upsertNurseUser(u: AuthUser): Promise<{ ok: boolean; error?: string }> {
  const isCreate = !u.id;
  const result = isCreate
    ? await apiCreateUser({
        role: "nurse",
        email: u.username,
        password: u.password || "phase8-nurse-temp-password",
        fullName: u.name,
        isActive: u.isActive,
      })
    : await apiPatchUser(u.id, { fullName: u.name, isActive: u.isActive });
  if (result.ok) await nurseStore.refresh();
  return result;
}

export async function deleteNurseUser(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await apiDeleteUser(id);
  if (result.ok) await nurseStore.refresh();
  return result;
}

export async function setNurseUserActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const result = await apiPatchUser(id, { isActive });
  if (result.ok) await nurseStore.refresh();
  return result;
}

export async function resetNurseUserPassword(id: string, password: string): Promise<{ ok: boolean; error?: string }> {
  return apiResetUserPassword(id, password);
}

export async function upsertLabUser(u: LabUser): Promise<{ ok: boolean; error?: string }> {
  const isCreate = !u.id;
  const result = isCreate
    ? await apiCreateUser({
        role: "lab",
        email: u.username,
        password: u.password || "phase8-lab-temp-password",
        fullName: u.fullName,
        labId: u.labId,
        labRole: u.role,
        isActive: u.isActive,
      })
    : await apiPatchUser(u.id, {
        fullName: u.fullName,
        labId: u.labId,
        labRole: u.role,
        isActive: u.isActive,
      });
  if (result.ok) await labUserStore.refresh();
  return result;
}

export async function deleteLabUser(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await apiDeleteUser(id);
  if (result.ok) await labUserStore.refresh();
  return result;
}

export async function setLabUserActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const result = await apiPatchUser(id, { isActive });
  if (result.ok) await labUserStore.refresh();
  return result;
}

export async function resetLabUserPassword(id: string, password: string): Promise<{ ok: boolean; error?: string }> {
  return apiResetUserPassword(id, password);
}
