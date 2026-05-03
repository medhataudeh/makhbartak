import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

interface InsertBody {
  /** One of these must be set; the route resolves to profiles.id. */
  recipientCustomerId?: string;
  recipientNurseId?: string;
  recipientProfileId?: string;
  type: string;
  titleAr: string;
  bodyAr: string;
  orderId?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Any authenticated role can fire a notification through this route; the
  // recipient resolution below is the gate.
  const body = (await req.json().catch(() => null)) as InsertBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  if (!body.type || !body.titleAr || !body.bodyAr) {
    return NextResponse.json({ error: "type, titleAr, bodyAr are required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  let profileId = body.recipientProfileId;
  if (!profileId && body.recipientCustomerId) {
    if (!isUuid(body.recipientCustomerId)) {
      return NextResponse.json({ error: "recipientCustomerId must be a uuid" }, { status: 400 });
    }
    const { data: c } = await sb
      .from("customers").select("profile_id").eq("id", body.recipientCustomerId).maybeSingle();
    profileId = c?.profile_id ?? undefined;
  }
  if (!profileId && body.recipientNurseId) {
    if (!isUuid(body.recipientNurseId)) {
      return NextResponse.json({ error: "recipientNurseId must be a uuid" }, { status: 400 });
    }
    const { data: n } = await sb
      .from("nurses").select("profile_id").eq("id", body.recipientNurseId).maybeSingle();
    profileId = n?.profile_id ?? undefined;
  }
  if (!profileId || !isUuid(profileId)) {
    return NextResponse.json({ error: "recipient profile_id could not be resolved" }, { status: 400 });
  }
  if (body.orderId && !isUuid(body.orderId)) {
    return NextResponse.json({ error: "orderId must be a uuid" }, { status: 400 });
  }

  const { data: id, error } = await sb.rpc("insert_notification_admin", {
    p_recipient_id: profileId,
    p_type: body.type,
    p_title_ar: body.titleAr,
    p_body_ar: body.bodyAr,
    p_order_id: body.orderId ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id });
}
