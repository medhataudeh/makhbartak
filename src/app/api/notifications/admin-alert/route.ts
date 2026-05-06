import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import { rateLimit } from "@/lib/api/rate-limit";

// Phase 5.1 — operational alerts from nurse / lab / customer sessions to
// admins. Strictly allow-listed: only the notification types the system
// actually fires from the field are accepted, and rate-limited per user
// so a malicious session cannot spam admin inboxes.
//
// Replaces the old practice of routing these calls through
// /api/admin/notifications/broadcast, which is now admin-only.

const ALLOWED_TYPES = new Set([
  "admin_note",
  "lab_issue_opened",
  "lab_issue_resolved",
  "payment_collected",
  "shortage_request",
  "order_cancelled",
  "result_uploaded",
]);

interface Body {
  type: string;
  titleAr: string;
  bodyAr: string;
  orderId?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rl = rateLimit(req, {
    bucket: "notifications:admin-alert",
    max: 60,         // generous — supports order-creation bursts
    windowMs: 60_000,
    keyFor: () => auth.session.userId,
  });
  if (!rl.ok) return rl.response!;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !body.type || !body.titleAr || !body.bodyAr) {
    return NextResponse.json({ error: "type, titleAr, bodyAr are required" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(body.type)) {
    return NextResponse.json({ error: "نوع الإشعار غير مسموح" }, { status: 400 });
  }
  if (body.titleAr.length > 200 || body.bodyAr.length > 1000) {
    return NextResponse.json({ error: "العنوان أو المحتوى أطول من المسموح" }, { status: 400 });
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
  if (aErr) return NextResponse.json({ error: "تعذر إرسال الإشعار" }, { status: 500 });
  const recipients = (admins ?? []).map((a) => a.id as string);
  if (recipients.length === 0) return NextResponse.json({ ok: true, count: 0 });

  const results = await Promise.all(recipients.map((profileId) =>
    sb.rpc("insert_notification_admin", {
      p_recipient_id: profileId,
      p_type: body.type,
      p_title_ar: body.titleAr,
      p_body_ar: body.bodyAr,
      p_order_id: body.orderId ?? null,
    }),
  ));
  const failed = results.some((r) => r.error);
  if (failed) return NextResponse.json({ error: "تعذر إرسال الإشعار" }, { status: 500 });
  return NextResponse.json({ ok: true, count: recipients.length });
}
