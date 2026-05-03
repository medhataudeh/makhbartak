import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

// GET /api/admin/labs
// All labs visible to admin. The id returned is `labs.id` — what
// `orders.lab_id` and `assign_lab_admin` reference.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("labs")
    .select(`
      id, name_ar, name_en, phone_main, phone_secondary, email, whatsapp,
      city, area, address_full, lat, lng,
      supported_cities, working_hours, accepted_sample_types, avg_processing_hours,
      official_name, registration_number, license_number, tax_number,
      logo_url, primary_color, secondary_color, accent_color, portal_display_name, header_image_url,
      reveal_sell_price_to_lab, is_active, created_at, updated_at
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[api/admin/labs] list failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ labs: data ?? [] });
}

interface CreateLabBody {
  nameAr: string;
  nameEn?: string;
  phoneMain: string;
  city?: string;
  isActive?: boolean;
  supportedCities?: string[];
}

// POST /api/admin/labs — minimal creation. Richer edits go through PATCH
// /api/labs/[id], which already exists for the lab self-edit path.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: CreateLabBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.nameAr?.trim()) return NextResponse.json({ error: "nameAr required" }, { status: 400 });
  if (!body.phoneMain?.trim()) return NextResponse.json({ error: "phoneMain required" }, { status: 400 });
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("labs").insert({
    name_ar: body.nameAr.trim(),
    name_en: body.nameEn?.trim() || null,
    phone_main: body.phoneMain.trim(),
    city: body.city?.trim() || null,
    is_active: body.isActive ?? true,
    supported_cities: body.supportedCities ?? null,
  }).select("id").single();
  if (error) {
    console.error("[api/admin/labs] insert failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}
