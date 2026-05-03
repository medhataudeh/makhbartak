import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireCustomerSelfOrAdmin } from "@/lib/route-auth";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await ctx.params;
  if (!isUuid(customerId)) {
    return NextResponse.json({ error: "customer id must be a uuid" }, { status: 400 });
  }
  const auth = await requireCustomerSelfOrAdmin(customerId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data: customer, error: cErr } = await sb
    .from("customers").select("profile_id").eq("id", customerId).maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!customer?.profile_id) {
    return NextResponse.json({ notifications: [] });
  }
  const { data, error } = await sb
    .from("notifications")
    .select(`id, recipient_id, type, title_ar, body_ar, order_id, is_read, created_at`)
    .eq("recipient_id", customer.profile_id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [] });
}
