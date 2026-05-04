import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin, requireAuthedUser } from "@/lib/route-auth";

// GET — every portal (customer/nurse/lab/admin) hydrates branding via this
// route on mount. Public-read at the table level still means we surface it
// through a server route so client code never touches the row id directly.
export async function GET() {
  // Anonymous customers also call this endpoint while browsing the shell —
  // we don't gate the GET. The select bypasses RLS via service-role, but
  // the row is public-read anyway.
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("app_branding")
    .select("config, updated_at")
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    config: data?.config ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}

interface PutBody {
  config: Record<string, unknown>;
}

export async function PUT(req: NextRequest) {
  // Phase 1 still gates by AdminRole instead of true RLS — when real RLS
  // lands, these routes can either disappear or shrink to passthroughs.
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // requireAdmin already returned us the session, but pull the actor id
  // through a second call to keep the helper small and avoid threading
  // the session into the RPC call site.
  const actor = await requireAuthedUser();
  const body = (await req.json().catch(() => null)) as PutBody | null;
  if (!body || !body.config || typeof body.config !== "object") {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("update_app_branding_admin", {
    p_config: body.config,
    p_actor: actor.ok ? actor.session.userId : null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...(data ?? {}) });
}
