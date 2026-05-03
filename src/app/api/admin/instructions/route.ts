import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

interface UpsertBody {
  id?: string;
  key: string;
  titleAr: string;
  bodyAr?: string;
  icon?: string;
  priority?: number;
  isActive?: boolean;
}

export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("instruction_library")
    .select(`id, key, title_ar, body_ar, icon, priority, is_active`)
    .order("priority");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ instructions: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => null)) as UpsertBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: id, error } = await sb.rpc("upsert_instruction_admin", {
    p_id: body.id ?? null,
    p_key: body.key,
    p_title_ar: body.titleAr,
    p_body_ar: body.bodyAr ?? null,
    p_icon: body.icon ?? null,
    p_priority: body.priority ?? 50,
    p_is_active: body.isActive ?? true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id });
}
