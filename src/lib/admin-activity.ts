import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";
import type { RouteSession } from "./route-auth";

// F7 — best-effort admin audit-log writer.
//
// Wraps `log_activity_admin` (mig 020). The RPC is the only authorised
// writer for `public.admin_activity_logs`; this helper just packages the
// session/actor fields and the action shape that the existing
// `ActivityAction` UI label map already understands.
//
// Best-effort by design: a failed audit-log insert MUST NOT fail the
// user-facing operation. By the time this is called, the audited
// operation (refund, force-complete, user write, app-settings change)
// has already committed. Failing here would invert the contract — we'd
// be telling the operator their action failed when in fact only the
// audit row is missing. Any insert error is surfaced via `logger.warn`
// with full context for ops to reconcile.
//
// Phase 1 callers pass one of the existing ActivityAction strings the
// UI's `ACTIVITY_LABELS` already renders:
//   invoice_status   — refund / partial refund
//   order_update     — force-complete
//   user_edit        — admin user create/update/delete + password reset
//   settings_change  — app_settings PATCH
export async function logAdminActivity(
  sb: SupabaseClient,
  session: RouteSession,
  action: string,
  entity: string,
  entityId: string | null,
  details: string,
): Promise<void> {
  try {
    const { error } = await sb.rpc("log_activity_admin", {
      p_admin_id:   session.userId,
      p_admin_name: session.fullName ?? null,
      p_role:       "admin",
      p_action:     action,
      p_entity:     entity,
      p_entity_id:  entityId,
      p_details:    details,
    });
    if (error) {
      logger.warn("admin-activity log_activity_admin failed", {
        route: "admin-activity",
        code: error.code,
        action,
        entity,
        entityId,
        userId: session.userId,
      });
    }
  } catch (err) {
    logger.warn("admin-activity exception", {
      route: "admin-activity",
      action,
      entity,
      entityId,
      userId: session.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
