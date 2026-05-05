import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

interface BroadcastBody {
  type: string;
  titleAr: string;
  bodyAr: string;
  orderId?: string;
}

// Phase 3.5 admin live notifications. Fires one row per active admin
// profile so every operations user sees the alert. Caller is any
// authenticated session — nurses/labs/customers also need to hit this
// when their action (e.g. lab issue, payment collected) needs to alert
// admins. The recipient resolution + insert is service-role only.
export async function POST(req: NextRequest) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => null)) as BroadcastBody | null;
  if (!body || !body.type || !body.titleAr || !body.bodyAr) {
    return NextResponse.json({ error: "type, titleAr, bodyAr are required" }, { status: 400 });
  }
  if (body.orderId && !isUuid(body.orderId)) {
    return NextResponse.json({ error: "orderId must be a uuid" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: admins, error: aErr } = await sb
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  const recipients = (admins ?? []).map((a) => a.id as string);
  if (recipients.length === 0) return NextResponse.json({ ok: true, count: 0 });

  // Fire in parallel; we treat each insert as best-effort but report any
  // batch error so the caller sees the first failure.
  const results = await Promise.all(recipients.map((profileId) =>
    sb.rpc("insert_notification_admin", {
      p_recipient_id: profileId,
      p_type: body.type,
      p_title_ar: body.titleAr,
      p_body_ar: body.bodyAr,
      p_order_id: body.orderId ?? null,
    }),
  ));
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: recipients.length });
}
