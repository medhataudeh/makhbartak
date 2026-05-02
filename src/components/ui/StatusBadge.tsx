import { ORDER_STATUS_LABELS } from "@/lib/mock-data";
import type { OrderStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: OrderStatus }) {
  const config = ORDER_STATUS_LABELS[status] ?? { ar: status, color: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${config.color}`}>
      {config.ar}
    </span>
  );
}
