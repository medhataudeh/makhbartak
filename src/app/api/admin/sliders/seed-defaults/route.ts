import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

// POST /api/admin/sliders/seed-defaults
// One-shot helper for first-time setup. Inserts 4 default home_sliders rows
// only when the table is empty so admins can rerun safely without dupes.
// The defaults link the customer-builder + prescription flows that don't
// require a package id; package-target slides are intentionally NOT seeded
// because pkg ids vary per environment and a missing target shows up as a
// disabled slider in the customer UI.
const DEFAULTS = [
  {
    title_ar: "اختر تحاليلك بنفسك",
    subtitle_ar: "ابحث وأضف ما تحتاج فقط — سعر شفّاف لكل تحليل",
    mobile_image: "https://picsum.photos/seed/makhbartak-sl-custom-m/800/1000",
    desktop_image: "https://picsum.photos/seed/makhbartak-sl-custom-d/1600/800",
    price_label: "حسب اختيارك",
    cta_label: "ابدأ الآن",
    cta_target: "custom-builder",
    cta_target_id: null,
    tests_count: null,
    badge_ar: null,
    display_order: 1,
    is_active: true,
  },
  {
    title_ar: "ارفع وصفتك تأتيك التحاليل",
    subtitle_ar: "صوّر وصفة الطبيب وسنحدد التحاليل ونحجز الموعد",
    mobile_image: "https://picsum.photos/seed/makhbartak-sl-rx-m/800/1000",
    desktop_image: "https://picsum.photos/seed/makhbartak-sl-rx-d/1600/800",
    price_label: "حسب الوصفة",
    cta_label: "ارفع وصفتك",
    cta_target: "prescription",
    cta_target_id: null,
    tests_count: null,
    badge_ar: "ذكاء اصطناعي",
    display_order: 2,
    is_active: true,
  },
];

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();
  const { count, error: countErr } = await sb
    .from("home_sliders").select("id", { count: "exact", head: true });
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json({ ok: false, error: "home_sliders already populated" }, { status: 409 });
  }
  const { error } = await sb.from("home_sliders").insert(DEFAULTS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inserted: DEFAULTS.length });
}
