import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdminCap } from "@/lib/route-auth";
import { logAdminActivity } from "@/lib/admin-activity";

interface ResetBody {
  password: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "user id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAdminCap("users.reset_password");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: ResetBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.password || body.password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 chars" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error } = await sb.auth.admin.updateUserById(id, { password: body.password });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminActivity(
    sb,
    auth.session,
    "user_edit",
    "user",
    id,
    "reset_password",
  );

  return NextResponse.json({ ok: true });
}
