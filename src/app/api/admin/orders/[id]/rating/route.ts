import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

// Phase 3.6: admin viewer for the rating row attached to an order.
// Customer-self GET already exists at /api/orders/[id]/rating; this is the
// admin counterpart so OCC and lab/nurse leaderboards can read it.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("order_ratings")
    .select("id, order_id, customer_id, nurse_id, lab_id, overall_rating, nurse_rating, lab_rating, comment, created_at")
    .eq("order_id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rating: data ?? null });
}
