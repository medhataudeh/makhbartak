import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

const ACTION_TYPES = ["prescription", "custom-builder", "package", "external"] as const;

interface UpsertBody {
  id?: string;
  titleAr: string;
  descriptionAr?: string;
  ctaLabelAr?: string;
  actionType: (typeof ACTION_TYPES)[number];
  actionValue?: string;
  icon?: string;
  imageUrl?: string;
  accent?: string;
  displayOrder?: number;
  isActive?: boolean;
}

const SELECT = "id, title_ar, description_ar, cta_label_ar, action_type, action_value, icon, image_url, accent, display_order, is_active";

// GET /api/admin/home-actions — full list (admin), ordered.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("homepage_action_sections")
    .select(SELECT)
    .order("display_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sections: data ?? [] });
}

// POST /api/admin/home-actions — create/update a section (admin only).
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => null)) as UpsertBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  if (body.id != null && !isUuid(body.id)) {
    return NextResponse.json({ error: "معرّف القسم غير صالح" }, { status: 400 });
  }
  if (!body.titleAr?.trim()) {
    return NextResponse.json({ error: "العنوان مطلوب" }, { status: 400 });
  }
  if (!ACTION_TYPES.includes(body.actionType)) {
    return NextResponse.json({ error: "نوع الإجراء غير صالح" }, { status: 400 });
  }
  // A package action must carry a valid package uuid as its value.
  if (body.actionType === "package" && (!body.actionValue || !isUuid(body.actionValue))) {
    return NextResponse.json({ error: "اختر باقة صحيحة للإجراء" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: id, error } = await sb.rpc("upsert_home_action_admin", {
    p_id: body.id ?? null,
    p_title_ar: body.titleAr,
    p_description_ar: body.descriptionAr ?? null,
    p_cta_label_ar: body.ctaLabelAr ?? null,
    p_action_type: body.actionType,
    p_action_value: body.actionValue ?? null,
    p_icon: body.icon ?? null,
    p_image_url: body.imageUrl ?? null,
    p_accent: body.accent ?? null,
    p_display_order: body.displayOrder ?? 0,
    p_is_active: body.isActive ?? true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id });
}
