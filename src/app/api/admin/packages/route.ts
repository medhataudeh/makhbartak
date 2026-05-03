import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdminSession } from "@/lib/admin-auth";

interface UpsertBody {
  session: import("@/lib/types").AuthSession;
  id?: string;
  nameAr: string;
  nameEn?: string;
  descriptionAr?: string;
  fullDescriptionAr?: string;
  category?: string;
  price: number;
  originalPrice: number;
  mainImageUrl?: string;
  mobileImageUrl?: string;
  desktopImageUrl?: string;
  badgeAr?: string;
  displayOrder?: number;
  showInSlider?: boolean;
  isActive?: boolean;
  testIds?: string[];
}

export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("packages")
    .select(`id, name_ar, name_en, description_ar, full_description_ar, category, price, original_price, main_image_url, mobile_image_url, desktop_image_url, badge_ar, display_order, show_in_slider, is_active, items:package_items(lab_test_id, display_order)`)
    .is("deleted_at", null)
    .order("display_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ packages: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as UpsertBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const denied = requireAdminSession(body.session);
  if (denied) return NextResponse.json({ error: denied }, { status: body.session ? 403 : 401 });

  const sb = getSupabaseAdmin();
  const { data: id, error } = await sb.rpc("upsert_package_admin", {
    p_id: body.id ?? null,
    p_name_ar: body.nameAr,
    p_name_en: body.nameEn ?? null,
    p_description_ar: body.descriptionAr ?? null,
    p_full_description_ar: body.fullDescriptionAr ?? null,
    p_category: body.category ?? null,
    p_price: body.price,
    p_original_price: body.originalPrice,
    p_main_image_url: body.mainImageUrl ?? null,
    p_mobile_image_url: body.mobileImageUrl ?? null,
    p_desktop_image_url: body.desktopImageUrl ?? null,
    p_badge_ar: body.badgeAr ?? null,
    p_display_order: body.displayOrder ?? 0,
    p_show_in_slider: !!body.showInSlider,
    p_is_active: body.isActive ?? true,
    p_test_ids: body.testIds ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id });
}
