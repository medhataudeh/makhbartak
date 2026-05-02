import type {
  OrderStatus,
  CustomerOrderStatus,
} from "./types";
import { CUSTOMER_STATUS_STEPS } from "./types";

/**
 * Map an internal operational status to one of the 6 customer-facing buckets,
 * plus a distinct `needs_attention` state for failure forks.
 *
 * Why: customers should not see internal lifecycle noise (`priced`,
 * `nurse_assigned`, `lab_processing`, …). Failures aren't silently buried —
 * they surface as `needs_attention` so the user knows to contact support.
 *
 * `result_ready` is intentionally NOT a customer bucket. The lab confirms
 * upload → admin/system flips the order to `completed` and the customer sees
 * "مكتمل" with the result PDFs as the dominant element on the order page.
 */
export function toCustomerStatus(status: OrderStatus): CustomerOrderStatus {
  switch (status) {
    case "created":
    case "priced":
    case "scheduled":
      return "received";
    case "confirmed":
    case "nurse_assigned":
      return "confirmed";
    case "on_the_way":
    case "arrived":
      return "on_the_way";
    case "sample_collected":
      return "sample_collected";
    case "sent_to_lab":
    case "lab_processing":
      return "in_lab";
    case "result_ready":
    case "completed":
      return "completed";
    case "failed_to_collect":
    case "lab_issue":
    case "cancelled":
      return "needs_attention";
  }
}

/**
 * Index of the current customer status in the linear progress strip.
 * Returns -1 for `needs_attention` (rendered as a separate banner, not a step).
 */
export function customerStatusIndex(status: CustomerOrderStatus): number {
  return CUSTOMER_STATUS_STEPS.indexOf(status);
}

export function isTerminalCustomerStatus(status: CustomerOrderStatus): boolean {
  return status === "completed" || status === "needs_attention";
}
