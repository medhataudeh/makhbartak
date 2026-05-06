"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Clock, MapPin, FlaskConical, AlertTriangle, Bell } from "lucide-react";
import { hydrateOrdersForCustomer, useOrders } from "@/lib/store";
import { useSession } from "@/lib/auth";
import { formatDate, formatPrice } from "@/lib/utils";
import type { Order } from "@/lib/types";
import { CustomerStatusBadge } from "@/components/ui/CustomerStatusBadge";
import { toCustomerStatus } from "@/lib/order-status";
import { customerOrderRef } from "@/lib/order-utils";
import { OrderDetails } from "./OrderDetails";

interface OrdersListProps {
  onOpenNotifications?: () => void;
  unreadNotifications?: number;
  /** Phase 4.4 — relayed to OrderDetails for the "ادفع الآن" action. */
  onPayOnline?: (orderId: string) => void;
}

export function OrdersList({ onOpenNotifications, unreadNotifications = 0, onPayOnline }: OrdersListProps = {}) {
  const orders = useOrders();
  const session = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedOrder = orders.find((o) => o.id === selectedId) ?? null;

  // Phase 1: pull persisted orders for this customer when the tab opens.
  // No-op in mock-only mode (USE_SUPABASE=false).
  useEffect(() => {
    if (session?.role !== "customer") return;
    void hydrateOrdersForCustomer(session.linkedEntityId);
  }, [session?.role, session?.linkedEntityId]);

  return (
    <>
      <div className="flex flex-col pb-nav">
        <div className="px-4 pt-5 pb-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#164E63]">طلباتي</h1>
            <p className="text-sm text-gray-400 mt-0.5">{orders.length} طلبات</p>
          </div>
          {onOpenNotifications && (
            <button
              onClick={onOpenNotifications}
              aria-label={unreadNotifications > 0 ? `الإشعارات — ${unreadNotifications} غير مقروء` : "الإشعارات"}
              className="relative w-10 h-10 bg-white rounded-xl border border-gray-100 flex items-center justify-center cursor-pointer active:bg-gray-50"
            >
              <Bell size={18} className="text-[#164E63]" aria-hidden="true" />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
            </button>
          )}
        </div>

        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <FlaskConical size={48} className="text-gray-200 mb-4" />
            <p className="text-base font-semibold text-gray-400">لا توجد طلبات بعد</p>
            <p className="text-sm text-gray-300 mt-1">اطلب تحليلك الأول الآن</p>
          </div>
        ) : (
          <div className="px-4 space-y-3">
            {orders.map((order, i) => (
              <OrderCard key={order.id} order={order} index={i} onClick={() => setSelectedId(order.id)} />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedOrder && (
          <OrderDetails
            order={selectedOrder}
            onClose={() => setSelectedId(null)}
            onPayOnline={onPayOnline}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function OrderCard({ order, index, onClick }: { order: Order; index: number; onClick: () => void }) {
  const customer = toCustomerStatus(order.status);
  const isActive = customer === "confirmed" || customer === "on_the_way" || customer === "sample_collected" || customer === "in_lab";
  const isAttention = customer === "needs_attention";
  const isCompleted = customer === "completed";
  const titleAr = order.type === "package" ? order.packageSnapshot?.nameAr ?? order.packageNameAr : `${order.items.length} تحليل`;

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.22, ease: "easeOut" }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      aria-label={`عرض الطلب ${customerOrderRef(order)}`}
      className={`w-full text-start bg-white rounded-3xl border cursor-pointer overflow-hidden transition-all duration-200 ${
        isAttention ? "border-amber-200 shadow-[0_4px_18px_rgba(217,119,6,0.10)]" :
        isActive    ? "border-[#0891B2]/25 shadow-[0_4px_18px_rgba(8,145,178,0.10)]" :
        isCompleted ? "border-emerald-100 shadow-[0_2px_10px_rgba(16,185,129,0.08)]" :
                      "border-gray-100 shadow-[0_2px_10px_rgba(0,0,0,0.03)]"
      }`}
    >
      {isActive && !isAttention && (
        <div className="h-1 bg-gradient-to-l from-[#0891B2] to-[#22D3EE]" aria-hidden="true" />
      )}
      {isAttention && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-600" aria-hidden="true" />
          <span className="text-xs font-semibold text-amber-700">يحتاج متابعة — تواصل مع الدعم</span>
        </div>
      )}
      <div className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-[11px] text-gray-400">
              <span className="lat ltr-tech">{customerOrderRef(order)}</span>
            </p>
            <p className="text-[15px] font-bold text-[#164E63] mt-1 leading-tight truncate">{titleAr}</p>
          </div>
          <CustomerStatusBadge status={order.status} />
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-gray-400" aria-hidden="true" />
            <span className="truncate">{formatDate(order.visitDate)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin size={12} className="text-gray-400" aria-hidden="true" />
            <span className="truncate">{order.address.label}</span>
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">
          <span className="text-xs text-gray-400">
            {order.shift === "morning" ? "صباحي" : "مسائي"}
            {order.shiftStartTime && order.shiftEndTime && (
              <span className="lat ltr-tech ms-1">({order.shiftStartTime} – {order.shiftEndTime})</span>
            )}
          </span>
          <span className="inline-flex items-center gap-1 text-[#0891B2] text-xs font-semibold">
            عرض التفاصيل
            <ChevronLeft size={14} aria-hidden="true" />
          </span>
        </div>

        <div className="mt-3">
          <span className="text-base font-bold text-[#164E63]">{formatPrice(order.total)}</span>
        </div>
      </div>
    </motion.button>
  );
}
