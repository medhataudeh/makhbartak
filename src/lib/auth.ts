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

// Auth status sentinel: every portal needs to distinguish "haven't checked
// the cookie yet" from "definitely logged out". Without it, the very first
// render of /admin /lab /nurse / shows the login form for ~200ms while
// /api/me is still in flight, even when the cookie is valid.
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

let _cachedSession: AuthSession | null = null;
let _authStatus: AuthStatus = "loading";
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
      phone: r.phone ?? undefined,
      role: r.role as Role,
      linkedEntityId:
        r.role === "customer" ? (r.customerId ?? r.userId) :
        r.role === "nurse"    ? (r.nurseId ?? r.userId) :
        r.role === "lab"      ? (r.labUserId ?? r.userId) :
        r.userId,
      customerId: r.customerId ?? undefined,
      nurseId: r.nurseId ?? undefined,
      nurseCity: r.nurseCity ?? undefined,
      nursePhotoUrl: r.nursePhotoUrl ?? undefined,
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
    _authStatus = next ? "authenticated" : "unauthenticated";
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
    _authStatus = "unauthenticated";
    emitSession();
    return;
  }
  // First fetch: populate the cache from the cookie.
  void refreshSession();
  // Cross-tab sign-in/sign-out + token refresh propagate via this listener.
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      _cachedSession = null;
      _authStatus = "unauthenticated";
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

export function getAuthStatus(): AuthStatus {
  ensureAuthListenerWired();
  return _authStatus;
}

export function useSession(): AuthSession | null {
  return useSyncExternalStore(subscribeSession, getStoredSession, () => null);
}

// useAuthStatus() lets every portal render a "loading" splash while the
// cookie-based session is being verified, instead of flashing the login
// screen for ~200ms on every refresh.
export function useAuthStatus(): AuthStatus {
  return useSyncExternalStore(subscribeSession, getAuthStatus, () => "loading");
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
    _authStatus = "unauthenticated";
    emitSession();
    return {
      ok: false,
      error: "لا تملك صلاحية الوصول إلى هذه المنصة بهذا الحساب.",
    };
  }
  _cachedSession = next;
  _authStatus = "authenticated";
  emitSession();
  return { ok: true, session: next };
}

export async function logout(): Promise<void> {
  const sb = getSupabaseBrowser();
  if (sb) await sb.auth.signOut().catch(() => {});
  _cachedSession = null;
  _authStatus = "unauthenticated";
  emitSession();
}

// ─── Self-signup (customers only) ─────────────────────────────────────────
export interface SignupResult {
  ok: boolean;
  session?: AuthSession;
  error?: string;
}

export async function signupCustomer(input: {
  email: string;
  password: string;
  // Profile details are collected later (booking / profile completion), so
  // self-signup only needs email + password. Kept optional for the
  // invitation / admin-created paths that may still pass a name.
  fullName?: string;
  phone?: string;
}): Promise<SignupResult> {
  // Step 1: server creates the auth.user + profile + customer row via the
  // service role (email_confirm:true so the new account can sign in
  // immediately without an email verification round-trip).
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };

  // Step 2: sign in immediately so the rest of the app sees a valid session.
  const login = await loginUser(input.email, input.password, { allowedRoles: ["customer"] });
  if (!login.ok) return { ok: false, error: login.error ?? "تم إنشاء الحساب لكن تعذر تسجيل الدخول" };
  return { ok: true, session: login.session };
}

// ─── Forgot password / reset password ─────────────────────────────────────
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") return { ok: false, error: "window unavailable" };
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, origin: window.location.origin }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return { ok: true };
}

// Called from the /auth/reset-password landing page after Supabase has
// established a recovery session via the URL hash. We update the password
// using the live browser session, then sign out and redirect to login.
export async function applyNewPassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseBrowser();
  if (!sb) return { ok: false, error: "Supabase client not configured" };
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ─── Role helpers (kept for callers) ───────────────────────────────────────
export function hasRole(session: AuthSession | null, role: Role): boolean {
  return !!session && session.role === role;
}

import { isUuid } from "./supabase/uuid";
import type { Nurse, LabUser, AdminUser, AuthUser } from "./types";
import {
  fetchAdminUsers, fetchCustomerUsers, fetchNurseUsers, fetchLabUsers,
  apiCreateUser, apiPatchUser, apiDeleteUser, apiResetUserPassword,
} from "./admin-users-api";

// FINAL HARDENING: build a Nurse strictly from the enriched RouteSession
// returned by /api/me. The MOCK_NURSES seed-id fallback has been removed;
// a real Supabase Auth session always carries a UUID nurseId resolved
// from the `nurses` row, so demo data can no longer leak into the nurse
// shell. Returns null when the session lacks a nurse id — callers (NurseApp)
// surface an Arabic "session invalid" and force a re-login.
export function nurseFromSession(session: AuthSession | null): Nurse | null {
  if (!session || session.role !== "nurse") return null;
  const id = session.nurseId ?? session.linkedEntityId;
  if (!id) return null;
  return {
    id,
    name: session.name || "—",
    phone: "",
    city: session.nurseCity ?? "",
    photoUrl: session.nursePhotoUrl,
    isActive: true,
  };
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
export async function upsertAdmin(a: AdminUser): Promise<{ ok: boolean; id?: string; error?: string }> {
  // The admin form prefills `id` with a local slug ("ad-XYZ") for new rows;
  // only existing accounts have a real Supabase UUID. Any non-UUID id means
  // "create", regardless of truthiness.
  const isCreate = !isUuid(a.id);
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

export async function upsertCustomerUser(
  u: AuthUser & { phone?: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const isCreate = !isUuid(u.id);
  const result = isCreate
    ? await apiCreateUser({
        role: "customer",
        email: u.username,
        password: u.password || "phase8-customer-temp-password",
        fullName: u.name,
        phone: u.phone,
        isActive: u.isActive,
      })
    : await apiPatchUser(u.id, { fullName: u.name, phone: u.phone, isActive: u.isActive });
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

export async function upsertNurseUser(
  u: AuthUser & { phone?: string; city?: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const isCreate = !isUuid(u.id);
  const result = isCreate
    ? await apiCreateUser({
        role: "nurse",
        email: u.username,
        password: u.password || "phase8-nurse-temp-password",
        fullName: u.name,
        phone: u.phone,
        city: u.city,
        isActive: u.isActive,
      })
    : await apiPatchUser(u.id, { fullName: u.name, phone: u.phone, city: u.city, isActive: u.isActive });
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

export async function upsertLabUser(
  u: LabUser & { phone?: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const isCreate = !isUuid(u.id);
  const result = isCreate
    ? await apiCreateUser({
        role: "lab",
        email: u.username,
        password: u.password || "phase8-lab-temp-password",
        fullName: u.fullName,
        phone: u.phone,
        labId: u.labId,
        labRole: u.role,
        isActive: u.isActive,
      })
    : await apiPatchUser(u.id, {
        fullName: u.fullName,
        phone: u.phone,
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
