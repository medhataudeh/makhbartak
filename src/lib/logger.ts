// Phase 3.5 observability — central logger abstraction. Today this writes
// to console.warn/error with structured payloads. When Sentry is wired in
// Phase 4, swap the body to call Sentry.captureException with the same
// `context` map (orderId / userId / route). The call sites stay the same.

type Severity = "info" | "warn" | "error";

export interface LogContext {
  orderId?: string;
  userId?: string;
  route?: string;
  /** Additional structured fields. */
  [key: string]: unknown;
}

function emit(severity: Severity, message: string, context?: LogContext) {
  const payload = { severity, message, context, ts: new Date().toISOString() };
  if (severity === "error") console.error("[makhbartak]", payload);
  else if (severity === "warn") console.warn("[makhbartak]", payload);
  else console.log("[makhbartak]", payload);
  // TODO Phase 4: forward to Sentry.
  //   if (severity === "error") Sentry.captureException(new Error(message), { extra: context });
  //   else Sentry.captureMessage(message, { level: severity, extra: context });
}

export const logger = {
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
