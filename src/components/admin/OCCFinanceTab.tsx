"use client";
import { useState } from "react";
import { DollarSign, Pencil, Download } from "lucide-react";
import type { Order, AdminRole } from "@/lib/types";
import { ROLE_PERMISSIONS } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { setPaymentStatus, recordAdminCashPayment } from "@/lib/store";
import { useToast } from "@/components/ui/Toast";
import type { ControlCenterRole } from "@/components/admin/OrderControlCenter";
import { Card, ReasonSheet, hasCap, type OrderActorRef } from "@/components/admin/occ-helpers";

// U4.C: extracted from OrderControlCenter.tsx without behavioural change.
// State (refundOpen / recordCashOpen) stays inside this function — same as
// in the parent today; not lifted, not pushed down. Mutator signatures
// unchanged. Cap gates (canEditPricing / finance.cash / finance.refund)
// preserved verbatim. Refund-reason discard contract from U3.A preserved.
// Record-cash trim-to-undefined policy from U3.B preserved.
//
// Per the U4.C contract:
//   * No shared finance helper extraction.
//   * No ReasonSheet shared module.
// → Card / Row / ReasonSheet / canEditPricing / hasCap are duplicated
// locally below with byte-identical bodies. The OCC parent's copies stay
// in place for the remaining StickyHeader-side flows that still use them.

// ─── Local helpers (duplicated, same bodies as in OCC parent) ────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-xs text-[#164E63] text-end">{value}</span>
    </div>
  );
}

function canEditPricing(role: ControlCenterRole["role"]): boolean {
  if (role === "lab_user") return false;
  const perms = ROLE_PERMISSIONS[role as AdminRole] ?? [];
  return perms.includes("*") || perms.includes("invoices") || perms.includes("orders");
}

// ─── FinanceTab ──────────────────────────────────────────────────────────────

export function FinanceTab({ order, role, ref }: {
  order: Order; role: ControlCenterRole; ref: OrderActorRef;
}) {
  const toast = useToast();
  const editable = canEditPricing(role.role);
  const [refundOpen, setRefundOpen] = useState(false);
  const [recordCashOpen, setRecordCashOpen] = useState(false);
  return (
    <div className="space-y-3">
      <Card title="الملخص المالي" icon={<DollarSign size={14} aria-hidden="true" />}>
        <Row label="المجموع الفرعي" value={formatPrice(order.subtotal)} />
        <Row label="خصم الكوبون" value={order.couponDiscount > 0 ? `-${formatPrice(order.couponDiscount)} (${order.couponCode})` : "—"} />
        <Row label="الإجمالي" value={<span className="font-bold">{formatPrice(order.total)}</span>} />
        <Row label="طريقة الدفع" value={order.paymentMethod === "cash" ? "نقداً" : "إلكتروني"} />
        <Row label="حالة الدفع" value={order.paymentStatus} />
      </Card>

      {editable && (
        <Card title="إجراءات" icon={<Pencil size={14} aria-hidden="true" />}>
          <div className="flex flex-wrap gap-2">
            {/* Phase 4.1.1 — admin office cash collection. Calls
                admin_record_cash_payment which writes the paid payments row
                + (if a nurse is assigned) wallet credit + history in one
                transaction. Online and already-paid orders disable. */}
            {hasCap(role.role, "finance.cash") && (
              <Button
                size="sm"
                variant="outline"
                disabled={order.paymentMethod !== "cash" || order.paymentStatus === "paid"}
                onClick={() => setRecordCashOpen(true)}
              >تسجيل تحصيل نقدي</Button>
            )}
            {hasCap(role.role, "finance.refund") && (
              <Button
                size="sm"
                variant="outline"
                disabled={order.paymentStatus !== "paid"}
                onClick={() => setRefundOpen(true)}
              >استرداد الدفع</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Download size={13} aria-hidden="true" /> الفاتورة
            </Button>
          </div>
        </Card>
      )}

      <ReasonSheet
        open={refundOpen}
        title="استرداد الدفع"
        placeholder="سبب الاسترداد (اختياري — للسجل فقط)"
        confirmLabel="تأكيد الاسترداد"
        variant="danger"
        onCancel={() => setRefundOpen(false)}
        onConfirm={async (_reason) => {
          // Reason is collected for UX consistency with the prior prompt
          // but is intentionally not forwarded — setPaymentStatus has no
          // reason argument and the underlying RPC doesn't accept one
          // either. Same payload as today.
          void _reason;
          setRefundOpen(false);
          const r = await setPaymentStatus(order.id, "refunded", ref);
          if (!r.ok) toast.error(r.error ?? "تعذر استرداد الدفع");
          else toast.success("تم تسجيل الاسترداد");
        }}
      />
      <ReasonSheet
        open={recordCashOpen}
        title="تسجيل تحصيل نقدي"
        placeholder="ملاحظة (اختياري)"
        confirmLabel="تأكيد التحصيل"
        initialValue="تحصيل في المكتب"
        onCancel={() => setRecordCashOpen(false)}
        onConfirm={async (note) => {
          setRecordCashOpen(false);
          // Mirrors the prior `note?.trim() || undefined` policy: an
          // empty/whitespace-only note becomes undefined at the mutator
          // boundary, identical to the prompt-era payload.
          const trimmed = note.trim();
          const r = await recordAdminCashPayment(order.id, ref, trimmed || undefined);
          if (!r.ok) toast.error(r.error ?? "تعذر تسجيل التحصيل");
          else toast.success("تم تسجيل التحصيل النقدي");
        }}
      />
    </div>
  );
}
