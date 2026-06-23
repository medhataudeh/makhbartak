import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";

// GET /api/home-actions — PUBLIC, customer-safe.
//
// Returns only ACTIVE home action sections, ordered, with display-safe fields
// only (no created_at/updated_at, no internal flags). Read via the
// service-role client server-side; the table is RLS-locked so there is no
// direct anon access. No auth required — this is public marketing content.
export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("homepage_action_sections")
    .select("id, title_ar, description_ar, cta_label_ar, action_type, action_value, icon, image_url, accent, display_order, is_active")
    .eq("is_active", true)
    .order("display_order");
  if (error) return NextResponse.json({ error: "تعذر تحميل المحتوى" }, { status: 500 });
  return NextResponse.json({ sections: data ?? [] });
}
