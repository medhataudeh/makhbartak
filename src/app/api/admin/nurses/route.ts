import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

// GET /api/admin/nurses
// Returns all nurses joined with their profile so the admin order-control
// dropdowns and the operational nurse list see real DB rows. The id returned
// here is `nurses.id` — the FK that `orders.nurse_id` and `assign_nurse_admin`
// expect — so callers can pass it straight back without remapping.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("nurses")
    .select(`
      id, profile_id, city, is_active,
      profile:profiles!inner ( full_name, phone, photo_url )
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[api/admin/nurses] list failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ nurses: data ?? [] });
}
