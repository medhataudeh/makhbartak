import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { rateLimit } from "@/lib/api/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/invitations/[id] — display-safe invitation lookup for the
// /invite/accept page. No auth: the invitation id is an unguessable uuid that
// only the email recipient holds, and the RPC returns ONLY display-safe fields
// (no finance/system config, no raw permissions). Lookup is by invite id, not
// by email, so it cannot be used to probe whether an email has an account.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rl = rateLimit(req, { bucket: "invitations:lookup", max: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response!;

  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "الدعوة غير موجودة" }, { status: 404 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("get_platform_invitation_public", { p_id: id });
  if (error) {
    logger.error("invitation lookup failed", { route: "api/invitations/[id]", code: error.code });
    return NextResponse.json({ error: "تعذر تحميل الدعوة" }, { status: 500 });
  }
  if (!data) {
    // Generic — never reveals whether the id ever existed.
    return NextResponse.json({ error: "الدعوة غير موجودة" }, { status: 404 });
  }

  return NextResponse.json({ invitation: data });
}
