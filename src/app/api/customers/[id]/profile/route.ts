import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";

// One-shot read of every profile row a customer needs: patients, addresses,
// preferred payment method. Customer-side hydration uses this on mount.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await ctx.params;
  if (!isUuid(customerId)) {
    return NextResponse.json({ error: "customer id must be a uuid" }, { status: 400 });
  }
  const sb = getSupabaseAdmin();
  const [{ data: patients, error: pErr }, { data: addresses, error: aErr }, { data: customer, error: cErr }] = await Promise.all([
    sb.from("patients").select("id, customer_id, name, national_id, note, is_default")
      .eq("customer_id", customerId).is("deleted_at", null).order("is_default", { ascending: false }),
    sb.from("addresses").select("id, customer_id, label, description, city, area, lat, lng, is_default")
      .eq("customer_id", customerId).is("deleted_at", null).order("is_default", { ascending: false }),
    sb.from("customers").select("preferred_payment_method, default_patient_id, default_address_id")
      .eq("id", customerId).maybeSingle(),
  ]);
  if (pErr || aErr || cErr) {
    return NextResponse.json({ error: pErr?.message ?? aErr?.message ?? cErr?.message }, { status: 500 });
  }
  return NextResponse.json({
    patients: patients ?? [],
    addresses: addresses ?? [],
    paymentPreference: customer?.preferred_payment_method ?? null,
    defaultPatientId: customer?.default_patient_id ?? null,
    defaultAddressId: customer?.default_address_id ?? null,
  });
}
