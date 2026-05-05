import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

// Granular payments table for the admin Finance dashboard. Joins:
//   * orders → public_number, total
//   * nurses (collected_by) → name (via profiles.full_name)
// Filters: ?status=paid|pending|failed|refunded, ?method=cash|online,
// ?nurseId=<uuid>, ?limit=N (default 200, max 500).
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const method = url.searchParams.get("method");
  const nurseId = url.searchParams.get("nurseId");
  const rawLimit = Number(url.searchParams.get("limit") ?? 200);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 200, 1), 500);

  const sb = getSupabaseAdmin();
  let q = sb.from("payments")
    .select(`
      id, order_id, method, status, amount, currency, provider, provider_ref,
      paid_at, collected_by_nurse_id, collected_at,
      verified_by_admin_id, verified_at, created_at,
      order:orders!inner ( public_number, total, payment_method ),
      nurse:nurses ( id, profile:profiles!inner ( full_name ) )
    `)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("status", status);
  if (method) q = q.eq("method", method);
  if (nurseId) q = q.eq("collected_by_nurse_id", nurseId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string; order_id: string; method: string; status: string;
    amount: number; currency: string; provider: string | null; provider_ref: string | null;
    paid_at: string | null; collected_by_nurse_id: string | null; collected_at: string | null;
    verified_by_admin_id: string | null; verified_at: string | null; created_at: string;
    // PostgREST returns embedded to-one rows as arrays in the generated types.
    order: { public_number: string | null; total: number | null; payment_method: string }[] | null;
    nurse: { id: string; profile: { full_name: string | null }[] | null }[] | null;
  };
  const payments = (data ?? []).map((r) => {
    const row = r as unknown as Row;
    const orderRow = Array.isArray(row.order) ? row.order[0] : null;
    const nurseRow = Array.isArray(row.nurse) ? row.nurse[0] : null;
    const profileRow = nurseRow && Array.isArray(nurseRow.profile) ? nurseRow.profile[0] : null;
    return {
      id:               row.id,
      orderId:          row.order_id,
      orderPublicNumber: orderRow?.public_number ?? null,
      orderTotal:       Number(orderRow?.total ?? 0),
      method:           row.method,
      status:           row.status,
      amount:           Number(row.amount ?? 0),
      currency:         row.currency ?? "SYP",
      provider:         row.provider,
      providerRef:      row.provider_ref,
      paidAt:           row.paid_at,
      collectedAt:      row.collected_at,
      collectedByNurseId: row.collected_by_nurse_id,
      collectedByNurseName: profileRow?.full_name ?? null,
      verifiedByAdminId: row.verified_by_admin_id,
      verifiedAt:       row.verified_at,
      createdAt:        row.created_at,
    };
  });
  return NextResponse.json({ payments });
}
