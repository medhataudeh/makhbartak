import { NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/route-auth";

// Phase 8.1: client-side useSession() calls this on mount/auth-change to
// build the enriched RouteSession. Returns 401 when no JWT cookie.
export async function GET() {
  const r = await requireAuthedUser();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ session: r.session });
}
