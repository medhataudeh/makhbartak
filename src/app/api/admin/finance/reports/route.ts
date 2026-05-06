import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

// Phase 4.2 — basic finance reports. Per-day, per-nurse, per-status
// aggregations against the payments ledger. All buckets are net of partial
// refunds (amount - refunded_amount) so the totals reconcile with the
// finance overview.
//
// Filters (query string):
//   from        ISO date (YYYY-MM-DD), inclusive — clamped to last 90 days by default
//   to          ISO date, inclusive
//   nurseId     filter by collected_by_nurse_id
//   status      filter by payments.status
//
// Heavy BI lives elsewhere; this endpoint stays a single round-trip read of
// up to 5,000 rows so the admin dashboard can render without paging.

const PAID_STATUSES = ["paid", "paid_by_nurse", "verified_by_admin", "partially_refunded"] as const;

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const nurseId = url.searchParams.get("nurseId");
  const status = url.searchParams.get("status");

  const sb = getSupabaseAdmin();
  let q = sb.from("payments")
    .select(`
      id, status, amount, refunded_amount, collected_at, paid_at, created_at,
      collected_by_nurse_id,
      nurse:nurses ( profile:profiles!inner ( full_name ) )
    `)
    .order("collected_at", { ascending: false })
    .limit(5000);

  if (status) q = q.eq("status", status);
  else q = q.in("status", PAID_STATUSES as readonly string[] as string[]);
  if (nurseId) q = q.eq("collected_by_nurse_id", nurseId);
  if (from) q = q.gte("collected_at", `${from}T00:00:00.000Z`);
  if (to)   q = q.lte("collected_at", `${to}T23:59:59.999Z`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string; status: string;
    amount: number; refunded_amount: number | null;
    collected_at: string | null; paid_at: string | null; created_at: string;
    collected_by_nurse_id: string | null;
    nurse: { profile: { full_name: string | null }[] | null }[] | null;
  };

  const rows = (data ?? []) as unknown as Row[];

  const perDay = new Map<string, { date: string; revenue: number; refunded: number; count: number }>();
  const perNurse = new Map<string, { nurseId: string; nurseName: string; revenue: number; refunded: number; count: number }>();
  const perStatus = new Map<string, { status: string; revenue: number; count: number }>();

  let grossRevenue = 0;
  let netRevenue = 0;
  let totalRefunded = 0;

  for (const r of rows) {
    const ts = r.collected_at ?? r.paid_at ?? r.created_at;
    const day = ts ? ts.slice(0, 10) : "—";
    const gross = Number(r.amount ?? 0);
    const refunded = Number(r.refunded_amount ?? 0);
    const net = Math.max(0, gross - refunded);

    grossRevenue += gross;
    netRevenue   += net;
    totalRefunded += refunded;

    const dayBucket = perDay.get(day) ?? { date: day, revenue: 0, refunded: 0, count: 0 };
    dayBucket.revenue += net;
    dayBucket.refunded += refunded;
    dayBucket.count += 1;
    perDay.set(day, dayBucket);

    if (r.collected_by_nurse_id) {
      const nurseRow = Array.isArray(r.nurse) ? r.nurse[0] : null;
      const profileRow = nurseRow && Array.isArray(nurseRow.profile) ? nurseRow.profile[0] : null;
      const name = profileRow?.full_name ?? "—";
      const k = r.collected_by_nurse_id;
      const nurseBucket = perNurse.get(k) ?? { nurseId: k, nurseName: name, revenue: 0, refunded: 0, count: 0 };
      nurseBucket.revenue += net;
      nurseBucket.refunded += refunded;
      nurseBucket.count += 1;
      perNurse.set(k, nurseBucket);
    }

    const sBucket = perStatus.get(r.status) ?? { status: r.status, revenue: 0, count: 0 };
    sBucket.revenue += net;
    sBucket.count += 1;
    perStatus.set(r.status, sBucket);
  }

  return NextResponse.json({
    currency: "SYP",
    grossRevenue,
    netRevenue,
    totalRefunded,
    perDay: Array.from(perDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    perNurse: Array.from(perNurse.values()).sort((a, b) => b.revenue - a.revenue),
    perStatus: Array.from(perStatus.values()).sort((a, b) => b.revenue - a.revenue),
    rowCount: rows.length,
  });
}
