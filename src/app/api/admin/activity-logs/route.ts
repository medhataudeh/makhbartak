import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdminSession } from "@/lib/admin-auth";

interface LogBody {
  session: import("@/lib/types").AuthSession;
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
}

export async function GET(req: NextRequest) {
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
  const body = (await req.json().catch(() => null)) as LogBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const denied = requireAdminSession(body.session);
  if (denied) return NextResponse.json({ error: denied }, { status: body.session ? 403 : 401 });
  if (!body.action || !body.entity) {
    return NextResponse.json({ error: "action and entity are required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: id, error } = await sb.rpc("log_activity_admin", {
    p_admin_id: null,
    p_admin_name: body.session.name ?? null,
    p_role: body.session.role,
    p_action: body.action,
    p_entity: body.entity,
    p_entity_id: body.entityId ?? null,
    p_details: body.details ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id });
}
