// Phase 8: legacy `requireAdminSession(body.session)` is gone. Use
// `requireAdminFromCookie()` in admin routes instead — it reads the JWT
// from cookies via the route-auth helper. Re-exported below for callers
// that still want the same name.
//
// Routes call:
//   const auth = await requireAdminFromCookie();
//   if (!auth.ok) return NextResponse.json({error: auth.error}, {status: auth.status});
//   const session = auth.session;

import { requireAdmin } from "@/lib/route-auth";

export const requireAdminFromCookie = requireAdmin;
