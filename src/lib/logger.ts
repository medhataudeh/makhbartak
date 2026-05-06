// Central logger. Console-backed today; Sentry-ready via SENTRY_DSN.
//
// Phase 5.1 hardening:
//   * Redacts known sensitive keys (authorization headers, tokens, secrets,
//     passwords, Stripe secret + webhook signature, full bearer tokens) from
//     structured payloads before they are emitted.
//   * Sentry forwarding is optional. If `process.env.SENTRY_DSN` is not set
//     the logger falls back to console without crashing. The dynamic import
//     keeps `@sentry/*` out of the bundle when unused.
//   * Per-environment level: production stays warn/error; dev keeps info.

type Severity = "info" | "warn" | "error";

export interface LogContext {
  orderId?: string;
  paymentId?: string;
  userId?: string;
  route?: string;
  /** Additional structured fields. */
  [key: string]: unknown;
}

const REDACT_KEYS = new Set([
  "authorization", "auth", "cookie", "set-cookie",
  "password", "newpassword", "currentpassword",
  "token", "access_token", "refresh_token", "id_token",
  "client_secret", "stripe-signature", "stripe_secret_key",
  "secret", "api_key", "apikey",
]);

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[deep]";
  if (typeof value === "string") {
    if (/^Bearer\s+/i.test(value) || /^sk_(live|test)_/.test(value) || /^whsec_/.test(value)) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k.toLowerCase())) { out[k] = "[redacted]"; continue; }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(severity: Severity, message: string, context?: LogContext) {
  const cleaned = context ? (redact(context) as LogContext) : undefined;
  const payload = { severity, message, context: cleaned, ts: new Date().toISOString() };
  if (severity === "error") console.error("[makhbartak]", payload);
  else if (severity === "warn") console.warn("[makhbartak]", payload);
  else if (process.env.NODE_ENV !== "production") console.warn("[makhbartak][info]", payload);

  if (process.env.SENTRY_DSN) {
    void forwardToSentry(severity, message, cleaned).catch(() => { /* best-effort */ });
  }
}

async function forwardToSentry(severity: Severity, message: string, context?: LogContext): Promise<void> {
  try {
    // Resolve the optional package dynamically. If absent, this throws and
    // the catch in emit() swallows it. Variable indirection keeps the
    // bundler from hard-resolving the module on builds that don't include it.
    const moduleName = "@sentry/nextjs";
    const dyn = (Function("m", "return import(m)") as (m: string) => Promise<unknown>);
    const mod = (await dyn(moduleName)) as {
      captureException?: (err: unknown, opts?: { extra?: LogContext; level?: string }) => void;
      captureMessage?:   (msg: string,  opts?: { extra?: LogContext; level?: string }) => void;
    };
    if (severity === "error" && mod.captureException) {
      mod.captureException(new Error(message), { extra: context, level: "error" });
    } else if (mod.captureMessage) {
      mod.captureMessage(message, { extra: context, level: severity });
    }
  } catch {
    /* Sentry not installed or DSN invalid — already logged to console. */
  }
}

export const logger = {
  info:  (message: string, context?: LogContext) => emit("info",  message, context),
  warn:  (message: string, context?: LogContext) => emit("warn",  message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
