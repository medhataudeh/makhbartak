import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/route-auth";

// Phase 4.3 placeholder. Online refund-issuance lives in Phase 4.4 (admin
// triggers a refund on Stripe → webhook charge.refunded reconciles our
// ledger). For now the admin UI invites the operator to issue the refund
// directly from the provider dashboard; the webhook will write the
// payments + history rows automatically when the charge settles.
//
// We keep the route registered so the UI has a deterministic 501 to render
// against and a single place to flip on once Phase 4.4 lands.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  await ctx.params;
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(
    { error: "استرداد الدفع الإلكتروني سيكون عبر مزود الدفع" },
    { status: 501 },
  );
}
