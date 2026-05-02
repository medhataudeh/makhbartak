"use client";
import { useState } from "react";
import { Star } from "lucide-react";
import type { Order } from "@/lib/types";
import { useOrderRating, submitOrderRating } from "@/lib/ratings";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface Props {
  order: Order;
}

export function OrderRatingCard({ order }: Props) {
  const existing = useOrderRating(order.id);
  const toast = useToast();
  const [overall, setOverall] = useState(existing?.overallRating ?? 0);
  const [nurse, setNurse] = useState(existing?.nurseRating ?? 0);
  const [lab, setLab] = useState(existing?.labRating ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [submitting, setSubmitting] = useState(false);

  if (existing) {
    return (
      <section className="mx-4 mb-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
        <p className="text-sm font-bold text-emerald-800 mb-2">شكراً لتقييمك</p>
        <RatingSummary label="التجربة العامة" value={existing.overallRating} />
        {existing.nurseRating != null && <RatingSummary label="الممرض" value={existing.nurseRating} />}
        {existing.labRating != null && <RatingSummary label="المخبر" value={existing.labRating} />}
        {existing.comment && (
          <p className="text-xs text-emerald-900/80 mt-2 leading-relaxed">&ldquo;{existing.comment}&rdquo;</p>
        )}
      </section>
    );
  }

  const submit = async () => {
    if (overall === 0) { toast.error("اختر تقييمك العام"); return; }
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 400));
    submitOrderRating({
      orderId: order.id,
      userId: order.userId,
      nurseId: order.nurseId,
      labId: order.labId,
      nurseRating: nurse > 0 ? nurse : undefined,
      labRating: lab > 0 ? lab : undefined,
      overallRating: overall,
      comment: comment.trim() || undefined,
    });
    setSubmitting(false);
    toast.success("تم إرسال تقييمك. شكراً لك");
  };

  return (
    <section className="mx-4 mb-4 rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
      <p className="text-sm font-bold text-amber-900 mb-2">قيّم تجربتك مع الطلب</p>
      <p className="text-[11px] text-amber-800/80 leading-relaxed mb-3">
        تقييمك يساعدنا على رفع جودة الخدمة. مرة واحدة فقط لكل طلب.
      </p>

      <RatingRow label="التجربة العامة" value={overall} onChange={setOverall} />
      {order.nurseId && <RatingRow label="الممرض" value={nurse} onChange={setNurse} />}
      {order.labId   && <RatingRow label="المخبر" value={lab} onChange={setLab} />}

      <label className="block mt-3">
        <span className="text-[11px] font-medium text-amber-900">تعليق (اختياري)</span>
        <textarea
          value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
          placeholder="شاركنا رأيك"
          className="w-full mt-1 px-3 py-2 rounded-xl border border-amber-200 bg-white text-sm text-[#164E63] focus:border-amber-400 outline-none resize-none"
        />
      </label>

      <Button variant="primary" size="md" className="w-full mt-3" loading={submitting} onClick={submit}>
        إرسال التقييم
      </Button>
    </section>
  );
}

function RatingRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs font-medium text-[#164E63]">{label}</span>
      <Stars value={value} onChange={onChange} />
    </div>
  );
}

function RatingSummary({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-emerald-900">{label}</span>
      <Stars value={value} readOnly />
    </div>
  );
}

function Stars({ value, onChange, readOnly }: { value: number; onChange?: (v: number) => void; readOnly?: boolean }) {
  return (
    <div className="flex items-center gap-0.5" role={readOnly ? undefined : "radiogroup"} aria-label="التقييم">
      {[1, 2, 3, 4, 5].map((n) => {
        const active = n <= value;
        return (
          <button
            key={n}
            type="button"
            disabled={readOnly}
            onClick={() => onChange?.(n)}
            aria-pressed={active}
            aria-label={`${n} من 5`}
            className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer ${readOnly ? "cursor-default" : "active:scale-95 transition-transform"}`}
          >
            <Star
              size={18}
              strokeWidth={1.5}
              className={active ? "text-amber-500" : "text-gray-300"}
              fill={active ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
