import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

// POST /api/admin/home-actions/seed-defaults
// First-time setup helper. Inserts the two default home action cards only when
// the table is empty so admins can rerun safely without dupes. (Migration 047
// also seeds these; this route exists for environments where the table was
// emptied.)
const DEFAULTS = [
  {
    title_ar: "ارفع وصفة",
    description_ar: "صوّر وصفة الطبيب وسنحدد التحاليل ونحجز الموعد",
    cta_label_ar: "ارفع الآن",
    action_type: "prescription",
    icon: "Camera",
    image_url: "https://picsum.photos/seed/makhbartak-rx/800/520",
    accent: "purple",
    display_order: 1,
    is_active: true,
  },
  {
    title_ar: "اختر تحاليلك بنفسك",
    description_ar: "ابحث وأضف ما تحتاج فقط — سعر شفّاف لكل تحليل",
    cta_label_ar: "ابدأ الاختيار",
    action_type: "custom-builder",
    icon: "FlaskConical",
    image_url: "https://picsum.photos/seed/makhbartak-custom/800/520",
    accent: "emerald",
    display_order: 2,
    is_active: true,
  },
];

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();

  const { count, error: countErr } = await sb
    .from("homepage_action_sections")
    .select("id", { count: "exact", head: true });
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { error } = await sb.from("homepage_action_sections").insert(DEFAULTS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inserted: DEFAULTS.length });
}
