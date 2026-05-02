import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentPage } from "@/lib/types";

// Reads all rows from public.content_pages and maps snake_case → camelCase
// to match the UI ContentPage shape. Caller merges these on top of seed
// defaults so missing slugs still render.
//
// Returns null on error so callers can keep using the legacy local value.
export async function fetchContentPages(
  sb: SupabaseClient
): Promise<ContentPage[] | null> {
  const { data, error } = await sb
    .from("content_pages")
    .select(
      "id, slug, title_ar, body_ar, faq_items, support_phone, support_whatsapp, is_active, updated_at"
    );
  if (error || !data) return null;

  return data.map((r) => ({
    id: r.id,
    slug: r.slug,
    titleAr: r.title_ar,
    bodyAr: r.body_ar,
    faqItems: r.faq_items ?? undefined,
    supportPhone: r.support_phone ?? undefined,
    supportWhatsapp: r.support_whatsapp ?? undefined,
    isActive: r.is_active,
    updatedAt: r.updated_at,
  })) as ContentPage[];
}
