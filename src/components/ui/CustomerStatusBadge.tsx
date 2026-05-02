import type { CustomerOrderStatus, OrderStatus } from "@/lib/types";
import { CUSTOMER_STATUS_LABELS } from "@/lib/types";
import { toCustomerStatus } from "@/lib/order-status";

const COLOR_BY_STATUS: Record<CustomerOrderStatus, string> = {
  received:         "bg-gray-100 text-gray-700",
  confirmed:        "bg-cyan-100 text-cyan-700",
  on_the_way:       "bg-purple-100 text-purple-700",
  sample_collected: "bg-emerald-100 text-emerald-700",
  in_lab:           "bg-sky-100 text-sky-700",
  completed:        "bg-green-100 text-green-700",
  needs_attention:  "bg-amber-100 text-amber-700",
};

interface Props {
  /** Pass either an internal OrderStatus or a CustomerOrderStatus directly. */
  status: OrderStatus | CustomerOrderStatus;
}

export function CustomerStatusBadge({ status }: Props) {
  const customer: CustomerOrderStatus =
    status in CUSTOMER_STATUS_LABELS
      ? (status as CustomerOrderStatus)
      : toCustomerStatus(status as OrderStatus);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${COLOR_BY_STATUS[customer]}`}>
      {CUSTOMER_STATUS_LABELS[customer]}
    </span>
  );
}
