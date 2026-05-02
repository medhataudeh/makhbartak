"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, BellOff, CheckCheck, CheckCircle2, UserCheck, Navigation, Droplets, ClipboardList, CreditCard, Route, XCircle, AlertTriangle, MessageCircle, ChevronLeft } from "lucide-react";
import { useCustomerNotifications, markNotificationRead, markAllNotificationsRead, getOrder } from "@/lib/store";
import { relativeTime, formatDate } from "@/lib/utils";
import type { Notification, NotificationType, Order } from "@/lib/types";
import { OrderDetails } from "@/components/order/OrderDetails";

const TYPE_STYLES: Record<NotificationType, { bg: string; icon: React.ReactNode }> = {
  order_confirmed:       { bg: "bg-[#ECFEFF]", icon: <CheckCircle2 size={18} className="text-[#0891B2]" aria-hidden="true" /> },
  nurse_assigned:        { bg: "bg-indigo-50",  icon: <UserCheck size={18} className="text-indigo-600" aria-hidden="true" /> },
  nurse_on_way:          { bg: "bg-purple-50",  icon: <Navigation size={18} className="text-purple-600" aria-hidden="true" /> },
  sample_collected:      { bg: "bg-emerald-50", icon: <Droplets size={18} className="text-emerald-600" aria-hidden="true" /> },
  result_ready:          { bg: "bg-green-50",   icon: <ClipboardList size={18} className="text-green-600" aria-hidden="true" /> },
  payment_issue:         { bg: "bg-red-50",     icon: <CreditCard size={18} className="text-red-500" aria-hidden="true" /> },
  route_changed:         { bg: "bg-cyan-50",    icon: <Route size={18} className="text-[#0891B2]" aria-hidden="true" /> },
  appointment_cancelled: { bg: "bg-red-50",     icon: <XCircle size={18} className="text-red-500" aria-hidden="true" /> },
  lab_issue:             { bg: "bg-amber-50",   icon: <AlertTriangle size={18} className="text-amber-600" aria-hidden="true" /> },
  admin_note:            { bg: "bg-gray-100",   icon: <MessageCircle size={18} className="text-gray-600" aria-hidden="true" /> },
};

export function NotificationsScreen() {
  const notifications = useCustomerNotifications();
  const unread = notifications.filter((n) => !n.isRead).length;
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [detailNotif, setDetailNotif] = useState<Notification | null>(null);

  const handleClick = (n: Notification) => {
    markNotificationRead(n.id);
    if (n.orderId) {
      const order = getOrder(n.orderId);
      if (order) { setOpenOrder(order); return; }
    }
    setDetailNotif(n);
  };

  return (
    <div className="flex flex-col pb-24">
      <div className="px-4 pt-5 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#164E63]">الإشعارات</h1>
          {unread > 0 && (
            <p className="text-xs text-[#0891B2] mt-0.5">{unread} غير مقروء</p>
          )}
        </div>
        {unread > 0 && (
          <button
            onClick={markAllNotificationsRead}
            className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer px-3 py-1.5 rounded-lg bg-gray-100"
          >
            <CheckCheck size={14} />
            قراءة الكل
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <BellOff size={48} className="text-gray-200 mb-4" />
          <p className="text-base font-semibold text-gray-400">لا توجد إشعارات</p>
        </div>
      ) : (
        <div className="px-4 space-y-2">
          <AnimatePresence>
            {notifications.map((n, i) => (
              <NotificationItem key={n.id} notification={n} index={i} onClick={() => handleClick(n)} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {openOrder && (
          <OrderDetails order={openOrder} onClose={() => setOpenOrder(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailNotif && (
          <NotificationDetail notification={detailNotif} onClose={() => setDetailNotif(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificationItem({ notification: n, index, onClick }: {
  notification: Notification;
  index: number;
  onClick: () => void;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      onClick={onClick}
      aria-label={n.titleAr}
      className={`w-full text-start flex items-start gap-4 p-4 rounded-2xl cursor-pointer transition-all duration-200 ${
        n.isRead ? "bg-white border border-gray-100" : "bg-[#ECFEFF] border border-[#0891B2]/20"
      }`}
    >
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${TYPE_STYLES[n.type].bg}`}>
        {TYPE_STYLES[n.type].icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-semibold leading-snug ${n.isRead ? "text-[#164E63]" : "text-[#0E7490]"}`}>
            {n.titleAr}
          </p>
          {!n.isRead && <div className="w-2 h-2 rounded-full bg-[#0891B2] flex-shrink-0 mt-1" />}
        </div>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.bodyAr}</p>
        <div className="flex items-center justify-between mt-1">
          <p className="text-[11px] text-gray-300">{relativeTime(n.createdAt)}</p>
          {n.orderId && (
            <span className="text-[11px] text-[#0891B2] font-medium flex items-center gap-0.5">
              فتح الطلب
              <ChevronLeft size={12} />
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

function NotificationDetail({ notification: n, onClose }: { notification: Notification; onClose: () => void }) {
  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-0 z-50 bg-white flex flex-col"
      style={{ maxWidth: "448px", margin: "0 auto" }}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 safe-top">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center cursor-pointer"
          aria-label="إغلاق"
        >
          <ChevronLeft size={18} className="text-[#164E63] rotate-180" aria-hidden="true" />
        </button>
        <h2 className="text-[15px] font-bold text-[#164E63] flex-1">تفاصيل الإشعار</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${TYPE_STYLES[n.type].bg}`}>
            {TYPE_STYLES[n.type].icon}
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold text-[#164E63]">{n.titleAr}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatDate(n.createdAt)}</p>
          </div>
        </div>
        <p className="text-sm text-[#164E63] leading-relaxed">{n.bodyAr}</p>
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-gray-400" aria-hidden="true" />
          <span className="text-xs text-gray-400">
            {n.isRead ? "تمت القراءة" : "غير مقروء"}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
