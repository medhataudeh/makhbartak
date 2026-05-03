import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdminSession } from "@/lib/admin-auth";

interface UpsertBody {
  session: import("@/lib/types").AuthSession;
  id?: string;
  slug?: "terms" | "privacy" | "support" | "faq";
  titleAr: string;
  bodyAr?: string;
  faqItems?: Array<{ q: string; a: string }>;
  supportPhone?: string;
  supportWhatsapp?: string;
  isActive?: boolean;
}

export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_pages")
    .select(`id, slug, title_ar, body_ar, faq_items, support_phone, support_whatsapp, is_active, updated_at`)
    .order("slug");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pages: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as UpsertBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const denied = requireAdminSession(body.session);
  if (denied) return NextResponse.json({ error: denied }, { status: body.session ? 403 : 401 });

  const sb = getSupabaseAdmin();
  const { data: id, error } = await sb.rpc("upsert_content_page_admin", {
    p_id: body.id ?? null,
    p_slug: body.slug ?? null,
    p_title_ar: body.titleAr,
    p_body_ar: body.bodyAr ?? null,
    p_faq_items: body.faqItems ?? null,
    p_support_phone: body.supportPhone ?? null,
    p_support_whatsapp: body.supportWhatsapp ?? null,
    p_is_active: body.isActive ?? true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id });
}
