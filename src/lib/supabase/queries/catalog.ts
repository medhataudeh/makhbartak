import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Test,
  Package,
  TestCategory,
  PackageCategory,
} from "@/lib/types";

// All three queries return null on error so the caller falls back to
// the legacy mock arrays. Snake_case columns are mapped to the camelCase
// fields the UI types already expect.

export async function fetchCategories(
  sb: SupabaseClient
): Promise<TestCategory[] | null> {
  const { data, error } = await sb
    .from("test_categories")
    .select("id, name_ar, name_en")
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error || !data) return null;
  return data.map((r) => ({
    id: r.id,
    nameAr: r.name_ar,
    nameEn: r.name_en ?? "",
  }));
}

export async function fetchTests(
  sb: SupabaseClient
): Promise<Test[] | null> {
  const { data, error } = await sb
    .from("lab_tests")
    .select(
      "id, category_id, name_ar, name_en, short_name, aliases_ar, aliases_en, sample_type, cost_price, sell_price, is_active"
    )
    .is("deleted_at", null);
  if (error || !data) return null;
  return data.map((r) => ({
    id: r.id,
    nameAr: r.name_ar,
    nameEn: r.name_en ?? "",
    shortName: r.short_name ?? "",
    aliasesAr: r.aliases_ar ?? [],
    aliasesEn: r.aliases_en ?? [],
    categoryId: r.category_id ?? "",
    sampleType: r.sample_type,
    costPrice: Number(r.cost_price),
    sellPrice: Number(r.sell_price),
    instructionsAr: [],
    tools: [],
    isActive: r.is_active,
  }));
}

// Packages are returned with an empty `tests` array; the caller is responsible
// for joining tests by id (it already has the full test list from fetchTests).
// This keeps the SQL simple and lets us compose without a deep PostgREST join.
export async function fetchPackages(
  sb: SupabaseClient
): Promise<{ packages: Omit<Package, "tests">[]; itemsByPackage: Map<string, string[]> } | null> {
  const [pkgRes, itemsRes] = await Promise.all([
    sb
      .from("packages")
      .select(
        "id, name_ar, name_en, description_ar, full_description_ar, category, price, original_price, main_image_url, mobile_image_url, desktop_image_url, badge_ar, display_order, show_in_slider, is_active"
      )
      .is("deleted_at", null)
      .order("display_order", { ascending: true }),
    sb
      .from("package_items")
      .select("package_id, lab_test_id, display_order")
      .order("display_order", { ascending: true }),
  ]);
  if (pkgRes.error || !pkgRes.data || itemsRes.error || !itemsRes.data) {
    return null;
  }

  const itemsByPackage = new Map<string, string[]>();
  for (const row of itemsRes.data) {
    const list = itemsByPackage.get(row.package_id) ?? [];
    list.push(row.lab_test_id);
    itemsByPackage.set(row.package_id, list);
  }

  const packages: Omit<Package, "tests">[] = pkgRes.data.map((r) => ({
    id: r.id,
    nameAr: r.name_ar,
    nameEn: r.name_en ?? "",
    descriptionAr: r.description_ar ?? "",
    fullDescriptionAr: r.full_description_ar ?? "",
    category: (r.category ?? "all") as PackageCategory,
    price: Number(r.price),
    originalPrice: Number(r.original_price),
    mainImage: r.main_image_url ?? "",
    mobileImage: r.mobile_image_url ?? "",
    desktopImage: r.desktop_image_url ?? "",
    badgeAr: r.badge_ar ?? undefined,
    displayOrder: r.display_order,
    showInSlider: r.show_in_slider,
    isActive: r.is_active,
  }));

  return { packages, itemsByPackage };
}
