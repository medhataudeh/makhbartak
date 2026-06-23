import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import { safeApiError } from "@/lib/api/safe-error";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// POST /api/invitations/[id]/accept — finalize an invitation.
//
// The caller must be authenticated: they reached here by clicking the Supabase
// invite link, which signed them in. We pass the authed user's id + email to
// the accept RPC, which re-validates the email matches the invitation, refuses
// expired/revoked invites, assigns the role, and is idempotent (re-accept by
// the same user is a no-op success). The session is the source of truth for
// who is accepting — we never trust an email/role from the request body.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "الدعوة غير موجودة" }, { status: 404 });
  }

  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("accept_platform_invitation", {
    p_id:      id,
    p_user_id: auth.session.userId,
    p_email:   auth.session.email,
  });
  if (error) {
    const { status, body } = safeApiError(error, {
      route: "api/invitations/[id]/accept",
      fallback: "تعذر قبول الدعوة",
      context: { invitationId: id, userId: auth.session.userId },
    });
    return NextResponse.json(body, { status });
  }

  logger.info("invitation accepted", {
    route: "api/invitations/[id]/accept",
    invitationId: id,
    userId: auth.session.userId,
    targetRole: (data as { targetRole?: string } | null)?.targetRole ?? null,
  });

  return NextResponse.json(data ?? { ok: true });
}
