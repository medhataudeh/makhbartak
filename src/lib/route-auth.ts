import "server-only";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import type { Role } from "@/lib/types";

// Phase 8.1: single source of truth for "who is calling this route?"
// Reads the JWT from cookies, returns the enriched session shape every
// previous body.session check used to look at. RLS / admin gates remain
// the route's responsibility — this helper only authenticates and resolves
// the role-specific identity. It refuses anonymous traffic.

export type AdminSubRole =
  | "super_admin" | "operations_admin" | "lab_admin"
  | "customer_support" | "finance_admin" | "content_admin";

export type LabSubRole = "lab_admin" | "lab_accounting" | "lab_uploader";

export interface RouteSession {
  userId: string;             // auth.users.id == profiles.id
  email: string | null;
  fullName: string | null;
  role: Role;                 // customer | nurse | lab | admin
  isActive: boolean;
  customerId?: string;        // when role === "customer"
  nurseId?: string;           // when role === "nurse"
  nurseCity?: string;         // when role === "nurse"
  nursePhotoUrl?: string;     // when role === "nurse"
  labUserId?: string;         // when role === "lab"
  labId?: string;             // when role === "lab"
  labRole?: LabSubRole;       // when role === "lab"
  adminRole?: AdminSubRole;   // when role === "admin"
}

export type RouteAuthResult =
  | { ok: true; session: RouteSession }
  | { ok: false; status: number; error: string };

export async function requireAuthedUser(): Promise<RouteAuthResult> {
  const sb = await getSupabaseServer();
  if (!sb) {
    return { ok: false, status: 500, error: "Supabase server client unavailable" };
  }
  const { data: userRes, error: userErr } = await sb.auth.getUser();
  if (userErr || !userRes?.user) {
    return { ok: false, status: 401, error: "session required" };
  }
  const userId = userRes.user.id;

  // Resolve role + admin sub-role via service-role to bypass RLS during
  // identity resolution. RLS still gates anything the route does after this.
  const admin = getSupabaseAdmin();
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("id, role, admin_role, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (profErr || !profile) {
    return { ok: false, status: 403, error: "no profile for current user" };
  }

  const session: RouteSession = {
    userId,
    email: userRes.user.email ?? null,
    fullName: (profile.full_name as string | null) ?? null,
    role: profile.role as Role,
  };

  switch (session.role) {
    case "customer": {
      const { data } = await admin
        .from("customers").select("id").eq("profile_id", userId).maybeSingle();
      session.customerId = data?.id ?? undefined;
      break;
    }
    case "nurse": {
      const { data } = await admin
        .from("nurses").select("id").eq("profile_id", userId).maybeSingle();
      session.nurseId = data?.id ?? undefined;
      break;
    }
    case "lab": {
      const { data } = await admin
        .from("lab_users").select("id, lab_id, role")
        .eq("profile_id", userId).maybeSingle();
      if (data) {
        session.labUserId = data.id;
        session.labId = data.lab_id;
        session.labRole = data.role as LabSubRole;
      }
      break;
    }
    case "admin": {
      session.adminRole = (profile.admin_role as AdminSubRole | null) ?? "super_admin";
      break;
    }
  }

  return { ok: true, session };
}

export async function requireRole(role: Role | Role[]): Promise<RouteAuthResult> {
  const r = await requireAuthedUser();
  if (!r.ok) return r;
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(r.session.role)) {
    return { ok: false, status: 403, error: "role not authorized" };
  }
  return r;
}

export async function requireAdmin(): Promise<RouteAuthResult> {
  return requireRole("admin");
}

// Customer self-routes: caller must be the customer whose row is being
// touched, or an admin acting on their behalf.
export async function requireCustomerSelfOrAdmin(customerId: string): Promise<RouteAuthResult> {
  const r = await requireAuthedUser();
  if (!r.ok) return r;
  if (r.session.role === "admin") return r;
  if (r.session.role === "customer" && r.session.customerId === customerId) return r;
  return { ok: false, status: 403, error: "not authorized for this customer" };
}

// Nurse self-routes: caller must be the nurse whose row is being touched,
// or an admin.
export async function requireNurseSelfOrAdmin(nurseId: string): Promise<RouteAuthResult> {
  const r = await requireAuthedUser();
  if (!r.ok) return r;
  if (r.session.role === "admin") return r;
  if (r.session.role === "nurse" && r.session.nurseId === nurseId) return r;
  return { ok: false, status: 403, error: "not authorized for this nurse" };
}
