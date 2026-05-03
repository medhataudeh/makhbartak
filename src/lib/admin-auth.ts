import type { AuthSession } from "@/lib/types";

// Tiny helper used by every Stage F admin route. Returns null if the session
// is allowed to write, or an error message otherwise. The server route
// converts the message into a 401/403 response.
export function requireAdminSession(session: AuthSession | undefined | null): string | null {
  if (!session) return "session required";
  if (session.role !== "admin") return "only admin can perform this action";
  return null;
}
