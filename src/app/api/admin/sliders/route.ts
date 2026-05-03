import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdminSession } from "@/lib/admin-auth";

interface UpsertBody {
  session: import("@/lib/types").AuthSession;
  id?: string;
  titleAr: string;
  subtitleAr?: string;
  mobileImage?: string;
  desktopImage?: string;
  priceLabel?: string;
  ctaLabel?: string;
  ctaTarget: "package" | "custom-builder" | "prescription" | "external";
  ctaTargetId?: string;
  testsCount?: number;
  badgeAr?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("home_sliders")
    .select(`id, title_ar, subtitle_ar, mobile_image, desktop_image, price_label, cta_label, cta_target, cta_target_id, tests_count, badge_ar, display_order, is_active`)
    .order("display_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sliders: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as UpsertBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const denied = requireAdminSession(body.session);
  if (denied) return NextResponse.json({ error: denied }, { status: body.session ? 403 : 401 });

  const sb = getSupabaseAdmin();
  const { data: id, error } = await sb.rpc("upsert_slider_admin", {
    p_id: body.id ?? null,
    p_title_ar: body.titleAr,
    p_subtitle_ar: body.subtitleAr ?? null,
    p_mobile_image: body.mobileImage ?? null,
    p_desktop_image: body.desktopImage ?? null,
    p_price_label: body.priceLabel ?? null,
    p_cta_label: body.ctaLabel ?? null,
    p_cta_target: body.ctaTarget,
    p_cta_target_id: body.ctaTargetId ?? null,
    p_tests_count: typeof body.testsCount === "number" ? body.testsCount : null,
    p_badge_ar: body.badgeAr ?? null,
    p_display_order: body.displayOrder ?? 0,
    p_is_active: body.isActive ?? true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id });
}
