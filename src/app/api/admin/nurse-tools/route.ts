import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdminSession } from "@/lib/admin-auth";

interface UpsertBody {
  session: import("@/lib/types").AuthSession;
  id?: string;
  nameAr: string;
  unit: string;
  isActive?: boolean;
}

export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("nurse_tools")
    .select(`id, name_ar, unit, is_active`)
    .order("name_ar");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tools: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as UpsertBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const denied = requireAdminSession(body.session);
  if (denied) return NextResponse.json({ error: denied }, { status: body.session ? 403 : 401 });

  const sb = getSupabaseAdmin();
  const { data: id, error } = await sb.rpc("upsert_nurse_tool_admin", {
    p_id: body.id ?? null,
    p_name_ar: body.nameAr,
    p_unit: body.unit,
    p_is_active: body.isActive ?? true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id });
}
