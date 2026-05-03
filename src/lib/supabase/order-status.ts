import type { OrderStatus } from "@/lib/types";

// SQL public.order_status enum. Kept as a string union so we don't need to
// import a generated types file. After 023_order_status_arrived.sql this
// includes `arrived` between `nurse_on_way` and `sample_collected`.
export type SqlOrderStatus =
  | "pending_payment"
  | "paid"
  | "assigned"
  | "nurse_on_way"
  | "arrived"
  | "sample_collected"
  | "received_by_lab"
  | "processing"
  | "results_uploaded"
  | "completed"
  | "cancelled"
  | "refunded";

// Maps the 15-value TS union onto the SQL enum. Each TS value MUST have a
// distinct SQL value when the workflow actually transitions through it,
// otherwise a "status update" RPC becomes a no-op and the UI never advances.
// `on_the_way` ↔ `nurse_on_way` and `arrived` ↔ `arrived` are now distinct.
export function tsStatusToSql(s: OrderStatus): SqlOrderStatus {
  switch (s) {
    case "created":
    case "priced":
    case "scheduled":      return "pending_payment";
    case "confirmed":      return "paid";
    case "nurse_assigned": return "assigned";
    case "on_the_way":     return "nurse_on_way";
    case "arrived":        return "arrived";
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
    case "arrived":         return "arrived";
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
