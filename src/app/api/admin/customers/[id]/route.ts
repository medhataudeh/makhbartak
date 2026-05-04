import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

// Phase 2 production hardening: replace the AdminDashboard user drawer's
// MOCK_PATIENTS / MOCK_ADDRESSES / MOCK_NOTIFICATIONS reads with a single
// admin-scoped detail endpoint. Returns profile + customer + relations.
// Orders are deliberately NOT included here — the admin shell already
// hydrates them globally via /api/orders, so the drawer can filter the
// store. That avoids duplicate plumbing.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await ctx.params;
  if (!isUuid(customerId)) {
    return NextResponse.json({ error: "customer id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  // The customer + profile join is the canonical source for the drawer's
  // header row (name, phone, isActive). default_patient_id and
  // default_address_id come along for the patient/address sub-tabs.
  const { data: customer, error: cErr } = await sb
    .from("customers")
    .select(`
      id, profile_id, default_address_id, default_patient_id,
      preferred_payment_method,
      profile:profiles!inner ( full_name, phone, is_active )
    `)
    .eq("id", customerId)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!customer) return NextResponse.json({ error: "customer not found" }, { status: 404 });

  const [patientsRes, addressesRes, notifsRes] = await Promise.all([
    sb.from("patients")
      .select("id, customer_id, name, national_id, note, is_default, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
    sb.from("addresses")
      .select("id, customer_id, label, description, city, lat, lng, is_default, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
    sb.from("notifications")
      .select("id, recipient_id, type, title_ar, body_ar, order_id, is_read, created_at")
      // Notifications are addressed by profile_id, not customer.id.
      .eq("recipient_id", (customer as { profile_id: string }).profile_id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (patientsRes.error) return NextResponse.json({ error: patientsRes.error.message }, { status: 500 });
  if (addressesRes.error) return NextResponse.json({ error: addressesRes.error.message }, { status: 500 });
  if (notifsRes.error) return NextResponse.json({ error: notifsRes.error.message }, { status: 500 });

  return NextResponse.json({
    customer,
    patients: patientsRes.data ?? [],
    addresses: addressesRes.data ?? [],
    notifications: notifsRes.data ?? [],
  });
}
