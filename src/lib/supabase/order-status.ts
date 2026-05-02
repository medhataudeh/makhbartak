import type { OrderStatus } from "@/lib/types";

// SQL public.order_status enum (001_init_enums.sql:19-31).
// Kept as a string union so we don't need to import a generated types file.
export type SqlOrderStatus =
  | "pending_payment"
  | "paid"
  | "assigned"
  | "nurse_on_way"
  | "sample_collected"
  | "received_by_lab"
  | "processing"
  | "results_uploaded"
  | "completed"
  | "cancelled"
  | "refunded";

// Phase 1 maps the 15-value TS union onto the 11-value SQL enum.
// `failed_to_collect` / `lab_issue` / `arrived` have no clean SQL equivalent
// and are not written by Phase 1 (those flows still live in mock land).
export function tsStatusToSql(s: OrderStatus): SqlOrderStatus {
  switch (s) {
    case "created":
    case "priced":
    case "scheduled":      return "pending_payment";
    case "confirmed":      return "paid";
    case "nurse_assigned": return "assigned";
    case "on_the_way":
    case "arrived":        return "nurse_on_way";
    case "sample_collected": return "sample_collected";
    case "sent_to_lab":    return "received_by_lab";
    case "lab_processing":
    case "lab_issue":      return "processing";
    case "result_ready":   return "results_uploaded";
    case "completed":      return "completed";
    case "cancelled":
    case "failed_to_collect": return "cancelled";
  }
}

export function sqlStatusToTs(s: SqlOrderStatus | string): OrderStatus {
  switch (s) {
    case "pending_payment": return "created";
    case "paid":            return "confirmed";
    case "assigned":        return "nurse_assigned";
    case "nurse_on_way":    return "on_the_way";
    case "sample_collected": return "sample_collected";
    case "received_by_lab": return "sent_to_lab";
    case "processing":      return "lab_processing";
    case "results_uploaded": return "result_ready";
    case "completed":       return "completed";
    case "cancelled":
    case "refunded":        return "cancelled";
    default:                return "created";
  }
}
