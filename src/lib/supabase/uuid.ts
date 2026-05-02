// Pure UUID guards. Safe to import from server runtimes (Route Handlers,
// Server Components, Edge) and from client modules alike. No "use client",
// no window/localStorage, no SDK references.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function assertUuid(value: unknown, label = "id"): asserts value is string {
  if (!isUuid(value)) {
    throw new Error(`[supabase] ${label} is not a valid uuid: ${String(value)}`);
  }
}
