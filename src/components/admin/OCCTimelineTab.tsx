"use client";
import type { Order, OrderEventType } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

// U4.A: extracted from OrderControlCenter.tsx without behavioural change.
// EVENT_LABELS is co-located here — verified to have no other consumers in
// src/* at extraction time. Re-introducing references to it from outside
// this file would be a regression of that locality.
const EVENT_LABELS: Partial<Record<OrderEventType, string>> = {
  created: "تم إنشاء الطلب",
  scheduled: "تمت الجدولة",
  confirmed: "تم تأكيد الطلب",
  nurse_assigned: "تم تعيين الممرض",
  on_the_way: "الممرض في الطريق",
  arrived: "وصل الممرض",
  sample_collected: "تم أخذ العينة",
  sent_to_lab: "أُرسلت للمخبر",
  lab_processing: "يعالجها المخبر",
  result_uploaded: "تم رفع النتيجة",
  result_ready: "النتيجة جاهزة",
  result_sent: "تم إرسال النتيجة",
  completed: "اكتمل الطلب",
  failed_collection: "تعذّر أخذ العينة",
  lab_issue_opened: "تم فتح مشكلة في المخبر",
  lab_issue_resolved: "تم حل مشكلة المخبر",
  rescheduled: "تم إعادة الجدولة",
  cancelled: "تم إلغاء الطلب",
  payment_status_changed: "تغيّرت حالة الدفع",
  coupon_applied: "تم تطبيق كوبون",
  note_added: "تمت إضافة ملاحظة",
};

export function TimelineTab({ order }: { order: Order }) {
  const events = order.events ?? [];
  if (events.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">لا توجد أحداث بعد</p>;
  }
  return (
    <ol className="relative ms-3">
      <div className="absolute top-2 bottom-2 w-px bg-gray-200" aria-hidden="true" />
      {events.map((e) => (
        <li key={e.id} className="relative ps-5 pb-4">
          <div className="absolute start-[-5px] top-1.5 w-2.5 h-2.5 rounded-full bg-[#0891B2] ring-4 ring-white" aria-hidden="true" />
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[#164E63]">{EVENT_LABELS[e.type] ?? e.type}</p>
            <span className="text-[11px] text-gray-400">{relativeTime(e.createdAt)}</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {e.actor} {e.actorName ? `· ${e.actorName}` : ""}
            {e.note ? ` — ${e.note}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
