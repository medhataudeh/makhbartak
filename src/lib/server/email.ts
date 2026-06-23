import "server-only";
import { logger } from "@/lib/logger";

// Server-only transactional email sender via the Resend REST API.
//
// We call Resend over fetch rather than adding the `resend` SDK — same policy
// the codebase uses for Stripe (REST + fetch, no provider SDK dependency).
// RESEND_API_KEY and EMAIL_FROM are read here and NEVER exposed to the client:
// importing this module from a client component fails the build via the
// "server-only" guard above.
//
// Failure is non-throwing by default: callers that must not 500 on a mail
// hiccup get `{ ok:false }` and decide what to do. Every outcome is logged
// (the logger redacts secrets).

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Override the default From; falls back to EMAIL_FROM. */
  from?: string;
  /** Tag for structured logs (e.g. "invitation"). */
  kind?: string;
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = input.from ?? process.env.EMAIL_FROM;
  const route = "lib/server/email";

  if (!apiKey || !from) {
    logger.error("email not configured", { route, kind: input.kind, reason: "missing RESEND_API_KEY or EMAIL_FROM" });
    return { ok: false, error: "email transport not configured" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!res.ok) {
      // Resend returns a JSON error body; surface only a generic reason to
      // the caller and log the status. Never echo the API response verbatim
      // to clients.
      const detail = await res.text().catch(() => "");
      logger.error("email send failed", { route, kind: input.kind, status: res.status, detail: detail.slice(0, 300) });
      return { ok: false, error: `email provider responded ${res.status}` };
    }

    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    logger.info("email sent", { route, kind: input.kind, id: body?.id ?? null });
    return { ok: true, id: body?.id ?? null };
  } catch (err) {
    logger.error("email send exception", {
      route,
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "email send failed" };
  }
}
