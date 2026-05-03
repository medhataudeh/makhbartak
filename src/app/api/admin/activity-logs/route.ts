import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

interface LogBody {
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 500);
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("admin_activity_logs")
    .select(`id, admin_id, admin_name, role, action, entity, entity_id, details, created_at`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => null)) as LogBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  if (!body.action || !body.entity) {
    return NextResponse.json({ error: "action and entity are required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: id, error } = await sb.rpc("log_activity_admin", {
    p_admin_id: auth.session.userId,
    p_admin_name: auth.session.fullName ?? null,
    p_role: auth.session.role,
    p_action: body.action,
    p_entity: body.entity,
    p_entity_id: body.entityId ?? null,
    p_details: body.details ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id });
}
