import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

const ROLES = ["customer", "nurse", "lab", "admin"] as const;
type UserRole = (typeof ROLES)[number];

const ADMIN_SUB_ROLES = [
  "super_admin", "operations_admin", "lab_admin",
  "customer_support", "finance_admin", "content_admin",
] as const;
const LAB_SUB_ROLES = ["lab_admin", "lab_accounting", "lab_uploader"] as const;

interface CreateUserBody {
  role: UserRole;
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  isActive?: boolean;
  // Admin only:
  adminRole?: typeof ADMIN_SUB_ROLES[number];
  // Lab only:
  labId?: string;
  labRole?: typeof LAB_SUB_ROLES[number];
  // Nurse only:
  city?: string;
  photoUrl?: string;
}

// GET /api/admin/users?role=admin|customer|nurse|lab
// Returns the unified listing the AdminDashboard sub-sections render.
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const role = new URL(req.url).searchParams.get("role") as UserRole | null;
  if (!role || !ROLES.includes(role)) {
    return NextResponse.json({ error: "role query param required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  if (role === "admin") {
    const { data, error } = await sb
      .from("profiles")
      .select("id, full_name, phone, role, admin_role")
      .eq("role", "admin");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ users: data ?? [] });
  }
  if (role === "customer") {
    const { data, error } = await sb
      .from("customers")
      .select(`
        id, profile_id, default_address_id, default_patient_id,
        preferred_payment_method,
        profile:profiles!inner ( full_name, phone, is_active )
      `);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ users: data ?? [] });
  }
  if (role === "nurse") {
    const { data, error } = await sb
      .from("nurses")
      .select(`
        id, profile_id, city, is_active,
        profile:profiles!inner ( full_name, phone, photo_url )
      `);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ users: data ?? [] });
  }
  // lab
  const { data, error } = await sb
    .from("lab_users")
    .select(`
      id, profile_id, lab_id, role, is_active,
      profile:profiles!inner ( full_name, phone )
    `);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

// POST /api/admin/users — create a new auth user + role-specific row.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: CreateUserBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!ROLES.includes(body.role)) {
    return NextResponse.json({ error: "role must be customer | nurse | lab | admin" }, { status: 400 });
  }
  if (!body.email?.trim() || !body.password || body.password.length < 8) {
    return NextResponse.json({ error: "email + password (>=8 chars) required" }, { status: 400 });
  }
  if (!body.fullName?.trim()) {
    return NextResponse.json({ error: "fullName required" }, { status: 400 });
  }
  if (body.role === "admin" && !ADMIN_SUB_ROLES.includes(body.adminRole as typeof ADMIN_SUB_ROLES[number])) {
    return NextResponse.json({ error: "adminRole required for admin user" }, { status: 400 });
  }
  if (body.role === "lab") {
    if (!body.labId || !isUuid(body.labId)) {
      return NextResponse.json({ error: "labId (uuid) required for lab user" }, { status: 400 });
    }
    if (!LAB_SUB_ROLES.includes(body.labRole as typeof LAB_SUB_ROLES[number])) {
      return NextResponse.json({ error: "labRole required for lab user" }, { status: 400 });
    }
  }

  const sb = getSupabaseAdmin();
  // 1. Create the auth user. email_confirm:true so the user can log in immediately.
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email: body.email.trim(),
    password: body.password,
    email_confirm: true,
    user_metadata: { full_name: body.fullName },
  });
  if (createErr || !created.user) {
    return NextResponse.json({ error: createErr?.message ?? "createUser failed" }, { status: 500 });
  }
  const userId = created.user.id;

  // 2. The on-signup trigger inserts a profiles row + a customers row by
  //    default. Patch it to the requested role and reset role-specific rows.
  const { error: profErr } = await sb
    .from("profiles")
    .update({
      full_name: body.fullName,
      phone: body.phone ?? null,
      role: body.role,
      admin_role: body.role === "admin" ? body.adminRole : null,
      is_active: body.isActive ?? true,
    })
    .eq("id", userId);
  if (profErr) {
    await sb.auth.admin.deleteUser(userId).catch(() => null);
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  // 3. If the requested role isn't customer, drop the auto-created customers row.
  if (body.role !== "customer") {
    await sb.from("customers").delete().eq("profile_id", userId);
  }

  // 4. Insert the role-specific row.
  if (body.role === "nurse") {
    const { error } = await sb.from("nurses").insert({
      profile_id: userId,
      city: body.city ?? null,
      is_active: body.isActive ?? true,
    });
    if (error) {
      await sb.auth.admin.deleteUser(userId).catch(() => null);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (body.photoUrl) {
      await sb.from("profiles").update({ photo_url: body.photoUrl }).eq("id", userId);
    }
  } else if (body.role === "lab") {
    const { error } = await sb.from("lab_users").insert({
      profile_id: userId,
      lab_id: body.labId!,
      role: body.labRole!,
      is_active: body.isActive ?? true,
    });
    if (error) {
      await sb.auth.admin.deleteUser(userId).catch(() => null);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  // customer — already exists from the trigger.
  // admin — no role-specific table.

  return NextResponse.json({ id: userId, ok: true });
}
