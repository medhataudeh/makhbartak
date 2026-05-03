import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Phase 8.1: refresh the Supabase auth cookie on every request so SSR pages
// and route handlers see a fresh session. Skips static assets + image
// optimizer paths to avoid pointless work.
//
// Per @supabase/ssr docs: forward incoming cookies, allow setAll to mutate
// the response cookies.

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request: req });
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() { return req.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          req.cookies.set(name, value);
        });
        response = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Touch the session so the SDK refreshes the cookie when needed.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    // Apply to every route except Next internals and common static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|gif|svg|ico|woff2?)$).*)",
  ],
};
