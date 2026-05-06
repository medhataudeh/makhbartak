import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdminCap } from "@/lib/route-auth";
import { logAdminActivity } from "@/lib/admin-activity";

interface UpdateBody {
  patch: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminCap("system.app_settings.write");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => null)) as UpdateBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const patch = body.patch ?? {};
  const { error } = await sb.rpc("update_app_settings_admin", { p_patch: patch });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminActivity(
    sb,
    auth.session,
    "settings_change",
    "app_settings",
    "1",
    `keys:${Object.keys(patch).join(",")}`,
  );

  return NextResponse.json({ ok: true });
}
