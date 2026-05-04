import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

interface PostBody {
  overallRating: number;
  nurseRating?: number | null;
  labRating?: number | null;
  comment?: string | null;
}

// GET — return the rating row for this order (customer-self only). Used by
// OrderRatingCard to show the "thank you" summary on second visit.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  // Resolve the customer row from the session to scope the read. Admins
  // need a different read path (already covered by service-role queries on
  // the orders join).
  const { data: customer } = await sb
    .from("customers")
    .select("id")
    .eq("profile_id", auth.session.userId)
    .maybeSingle();
  if (!customer?.id) {
    return NextResponse.json({ rating: null });
  }
  const { data, error } = await sb
    .from("order_ratings")
    .select("id, order_id, customer_id, nurse_id, lab_id, overall_rating, nurse_rating, lab_rating, comment, created_at")
    .eq("order_id", id)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rating: data ?? null });
}

// POST — submit (or update) the rating for an order the caller owns. The
// RPC enforces order ownership and that the order is completed; we do a
// pre-flight clamp on the stars so a malformed body 400s here instead of
// 500ing inside Postgres.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "customer") {
    return NextResponse.json({ error: "only customers can rate" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const overall = Number(body.overallRating);
  if (!Number.isInteger(overall) || overall < 1 || overall > 5) {
    return NextResponse.json({ error: "overallRating must be 1..5" }, { status: 400 });
  }
  const nurse = body.nurseRating == null ? null : Number(body.nurseRating);
  const lab   = body.labRating   == null ? null : Number(body.labRating);
  if (nurse !== null && (!Number.isInteger(nurse) || nurse < 1 || nurse > 5)) {
    return NextResponse.json({ error: "nurseRating must be 1..5" }, { status: 400 });
  }
  if (lab !== null && (!Number.isInteger(lab) || lab < 1 || lab > 5)) {
    return NextResponse.json({ error: "labRating must be 1..5" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: customer, error: cErr } = await sb
    .from("customers").select("id").eq("profile_id", auth.session.userId).maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!customer?.id) {
    return NextResponse.json({ error: "customer profile missing" }, { status: 404 });
  }

  const { data, error } = await sb.rpc("submit_order_rating_admin", {
    p_order_id: orderId,
    p_customer_id: customer.id,
    p_overall_rating: overall,
    p_nurse_rating: nurse,
    p_lab_rating: lab,
    p_comment: body.comment ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, rating: data });
}
