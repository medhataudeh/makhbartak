import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdminSession } from "@/lib/admin-auth";

interface UpdateBody {
  session: import("@/lib/types").AuthSession;
  patch: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as UpdateBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const denied = requireAdminSession(body.session);
  if (denied) return NextResponse.json({ error: denied }, { status: body.session ? 403 : 401 });

  const sb = getSupabaseAdmin();
  const { error } = await sb.rpc("update_app_settings_admin", { p_patch: body.patch ?? {} });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
