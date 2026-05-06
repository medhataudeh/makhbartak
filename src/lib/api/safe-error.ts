import "server-only";
import { logger, type LogContext } from "@/lib/logger";

// Phase 5.1 — central wrapper for "we got a DB/RPC error, what do we tell
// the customer". Goals:
//   1. Never leak DB internals (column names, constraint names, RLS hints)
//      back to the browser.
//   2. Surface known business-rule errors verbatim — these are already
//      Arabic and customer-safe (raised with errcode P0001 by RPCs).
//   3. Always emit a structured log entry on the server side so the actual
//      error is reconstructible from telemetry.

export interface SupabaseLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

// Errors raised with `using errcode = 'P0001'` are our convention for
// "user-safe Arabic copy". Anything else is a privileged internal error and
// must NOT echo back.
const BUSINESS_ERRCODE = "P0001";

export interface SafeErrorOptions {
  /** Arabic fallback shown to the user when the underlying error is not
   *  a known business-rule (P0001) message. Required. */
  fallback: string;
  /** HTTP status to return for business-rule errors (default 409). */
  businessStatus?: number;
  /** HTTP status to return for unexpected errors (default 500). */
  serverStatus?: number;
  /** Route tag for the log entry. */
  route: string;
  /** Free-form context written to the log. orderId / paymentId / etc. */
  context?: LogContext;
  /** Extra heuristic: if the underlying message contains one of these
   *  Arabic phrases, treat as business and surface verbatim. The webhook
   *  surfaces RPC errors that may not carry the P0001 code. */
  arabicMarkers?: readonly string[];
}

export interface SafeErrorPayload {
  status: number;
  body: { error: string };
}

/** Map a Supabase / RPC error into a sanitized JSON response payload. */
export function safeApiError(
  err: SupabaseLikeError | Error | unknown,
  opts: SafeErrorOptions,
): SafeErrorPayload {
  const businessStatus = opts.businessStatus ?? 409;
  const serverStatus   = opts.serverStatus   ?? 500;

  let code: string | null = null;
  let message: string | null = null;
  let details: string | null = null;
  let hint: string | null = null;
  if (err && typeof err === "object") {
    const e = err as SupabaseLikeError & { name?: string; stack?: string };
    code    = (e.code ?? null) as string | null;
    message = (e.message ?? null) as string | null;
    details = (e.details ?? null) as string | null;
    hint    = (e.hint ?? null) as string | null;
  }

  const isBusinessByCode    = code === BUSINESS_ERRCODE;
  const isBusinessByMarkers = !!message && (opts.arabicMarkers ?? []).some((m) => message!.includes(m));
  const isBusiness = isBusinessByCode || isBusinessByMarkers;

  // Always log the raw error (sanitized by the logger's redactor).
  logger.error(`[${opts.route}] error`, {
    ...(opts.context ?? {}),
    route: opts.route,
    code, details, hint,
    message,
    classification: isBusiness ? "business" : "internal",
  });

  if (isBusiness && message) {
    return { status: businessStatus, body: { error: message } };
  }
  return { status: serverStatus, body: { error: opts.fallback } };
}
