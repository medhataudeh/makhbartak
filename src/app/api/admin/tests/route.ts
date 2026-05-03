import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

interface UpsertBody {
  id?: string;
  categoryId?: string;
  nameAr: string;
  nameEn?: string;
  shortName?: string;
  aliasesAr?: string[];
  aliasesEn?: string[];
  sampleType?: "blood" | "urine" | "saliva" | "stool" | "other";
  costPrice?: number;
  sellPrice?: number;
  isActive?: boolean;
  instructionIds?: string[];
}

export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("lab_tests")
    .select(`id, category_id, name_ar, name_en, short_name, aliases_ar, aliases_en, sample_type, cost_price, sell_price, is_active`)
    .is("deleted_at", null)
    .order("name_ar");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tests: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => null)) as UpsertBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: id, error } = await sb.rpc("upsert_test_admin", {
    p_id: body.id ?? null,
    p_category_id: body.categoryId ?? null,
    p_name_ar: body.nameAr,
    p_name_en: body.nameEn ?? null,
    p_short_name: body.shortName ?? null,
    p_aliases_ar: body.aliasesAr ?? null,
    p_aliases_en: body.aliasesEn ?? null,
    p_sample_type: body.sampleType ?? "blood",
    p_cost_price: body.costPrice ?? 0,
    p_sell_price: body.sellPrice ?? 0,
    p_is_active: body.isActive ?? true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(body.instructionIds)) {
    const { error: linkErr } = await sb.rpc("set_test_instructions_admin", {
      p_test_id: id, p_instruction_ids: body.instructionIds,
    });
    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
  }

  return NextResponse.json({ id });
}
