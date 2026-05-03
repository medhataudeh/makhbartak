import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireCustomerSelfOrAdmin } from "@/lib/route-auth";

interface SetDefaultPatientBody {
  /** patients.id; pass null to clear the preference. */
  patientId: string | null;
}

// Stores the customer's "last selected patient" preference on
// customers.default_patient_id (already in 002_init_tables.sql). The booking
// flow reads it via /api/customers/[id]/profile and writes it via this route
// every time the user picks a patient. No localStorage involvement —
// preference roams with the account across devices.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await ctx.params;
  if (!isUuid(customerId)) {
    return NextResponse.json({ error: "customer id must be a uuid" }, { status: 400 });
  }
  const auth = await requireCustomerSelfOrAdmin(customerId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: SetDefaultPatientBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Allow null/empty to clear the default. Otherwise verify the patient
  // exists and belongs to this customer — never trust the client to point
  // customers.default_patient_id at a row owned by someone else.
  if (body.patientId == null || body.patientId === "") {
    const { error } = await sb
      .from("customers")
      .update({ default_patient_id: null })
      .eq("id", customerId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, defaultPatientId: null });
  }

  if (!isUuid(body.patientId)) {
    return NextResponse.json({ error: "patientId must be a uuid" }, { status: 400 });
  }
  const { data: patient, error: pErr } = await sb
    .from("patients").select("id, customer_id").eq("id", body.patientId).maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!patient || patient.customer_id !== customerId) {
    return NextResponse.json({ error: "patient does not belong to this customer" }, { status: 404 });
  }

  const { error } = await sb
    .from("customers")
    .update({ default_patient_id: body.patientId })
    .eq("id", customerId);
  if (error) {
    console.error("[api/customers/default-patient] update failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, defaultPatientId: body.patientId });
}
