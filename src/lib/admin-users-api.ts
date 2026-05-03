"use client";
import type { AuthUser, AdminUser, LabUser, AdminRole } from "@/lib/types";

// Phase 8.5: thin client wrappers around /api/admin/users. The Supabase
// service-role calls (auth.admin.createUser / updateUserById / deleteUser)
// happen server-side in the route handlers; this module only translates
// shapes the AdminDashboard UI expects.

interface RawAdminProfile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  admin_role: AdminRole | null;
}
interface RawCustomerRow {
  id: string;
  profile_id: string;
  default_address_id: string | null;
  default_patient_id: string | null;
  preferred_payment_method: string | null;
  profile: { full_name: string | null; phone: string | null; is_active: boolean } | { full_name: string | null; phone: string | null; is_active: boolean }[];
}
interface RawNurseRow {
  id: string;
  profile_id: string;
  city: string | null;
  is_active: boolean;
  profile: { full_name: string | null; phone: string | null; photo_url: string | null } | { full_name: string | null; phone: string | null; photo_url: string | null }[];
}
interface RawLabUserRow {
  id: string;
  profile_id: string;
  lab_id: string;
  role: "lab_admin" | "lab_accounting" | "lab_uploader";
  is_active: boolean;
  profile: { full_name: string | null; phone: string | null } | { full_name: string | null; phone: string | null }[];
}

function unwrap<T>(x: T | T[]): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await fetch("/api/admin/users?role=admin", { cache: "no-store" });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  const rows = (body.users ?? []) as RawAdminProfile[];
  return rows.map((r) => ({
    id: r.id,
    username: "",  // email lives on auth.users; not surfaced in listing
    password: "",
    name: r.full_name ?? "",
    role: (r.admin_role ?? "super_admin") as AdminRole,
    isActive: true,
  }));
}

export async function fetchCustomerUsers(): Promise<AuthUser[]> {
  const res = await fetch("/api/admin/users?role=customer", { cache: "no-store" });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  const rows = (body.users ?? []) as RawCustomerRow[];
  return rows.map((r) => {
    const p = unwrap(r.profile);
    return {
      id: r.profile_id,
      username: "",
      password: "",
      name: p?.full_name ?? "",
      role: "customer" as const,
      linkedEntityId: r.id,
      isActive: p?.is_active ?? true,
    };
  });
}

export async function fetchNurseUsers(): Promise<AuthUser[]> {
  const res = await fetch("/api/admin/users?role=nurse", { cache: "no-store" });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  const rows = (body.users ?? []) as RawNurseRow[];
  return rows.map((r) => {
    const p = unwrap(r.profile);
    return {
      id: r.profile_id,
      username: "",
      password: "",
      name: p?.full_name ?? "",
      role: "nurse" as const,
      linkedEntityId: r.id,
      isActive: r.is_active,
    };
  });
}

export async function fetchLabUsers(): Promise<LabUser[]> {
  const res = await fetch("/api/admin/users?role=lab", { cache: "no-store" });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  const rows = (body.users ?? []) as RawLabUserRow[];
  return rows.map((r) => {
    const p = unwrap(r.profile);
    return {
      id: r.id,
      username: "",
      password: "",
      fullName: p?.full_name ?? "",
      labId: r.lab_id,
      role: r.role,
      isActive: r.is_active,
    };
  });
}

export interface CreateUserInput {
  role: "customer" | "nurse" | "lab" | "admin";
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  isActive?: boolean;
  adminRole?: AdminRole;
  labId?: string;
  labRole?: "lab_admin" | "lab_accounting" | "lab_uploader";
  city?: string;
  photoUrl?: string;
}

export async function apiCreateUser(input: CreateUserInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return { ok: true, id: body.id };
}

export interface PatchUserInput {
  fullName?: string;
  phone?: string;
  isActive?: boolean;
  adminRole?: AdminRole;
  city?: string;
  photoUrl?: string;
  labId?: string;
  labRole?: "lab_admin" | "lab_accounting" | "lab_uploader";
}

export async function apiPatchUser(id: string, patch: PatchUserInput): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return { ok: true };
}

export async function apiDeleteUser(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return { ok: true };
}

export async function apiResetUserPassword(id: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return { ok: true };
}
