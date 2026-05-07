"use client";
import { useState } from "react";
import { DollarSign, Pencil, Download } from "lucide-react";
import type { Order, OrderEvent, AdminRole } from "@/lib/types";
import { ROLE_PERMISSIONS } from "@/lib/types";
import { adminHas, type AdminCapability } from "@/lib/admin-permissions";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { setPaymentStatus, recordAdminCashPayment } from "@/lib/store";
import { useToast } from "@/components/ui/Toast";
import type { ControlCenterRole } from "@/components/admin/OrderControlCenter";

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

function Card({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 bg-gray-50/40">
        <h4 className="text-xs font-bold text-[#164E63] flex items-center gap-1.5">
          {icon}
          {title}
        </h4>
        {action}
      </header>
      <div className="p-4 space-y-1.5">
        {children}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-xs text-[#164E63] text-end">{value}</span>
    </div>
  );
}

function ReasonSheet({
  open,
  title,
  placeholder,
  required = false,
  multiline = true,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  initialValue = "",
  variant = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  placeholder: string;
  required?: boolean;
  multiline?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  initialValue?: string;
  variant?: "primary" | "danger";
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setValue(initialValue);
  }

  const trimmed = value.trim();
  const canSubmit = required ? trimmed.length > 0 : true;

  return (
    <BottomSheet open={open} onClose={onCancel} title={title}>
      <div className="space-y-3 px-4 pb-4">
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            placeholder={placeholder}
            className="w-full p-3 rounded-xl border border-gray-200 text-sm resize-none focus:border-[#0891B2] outline-none"
            aria-label={title}
            autoFocus
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none"
            aria-label={title}
            autoFocus
          />
        )}
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={variant === "danger" ? "danger" : "primary"}
            disabled={!canSubmit}
            onClick={() => onConfirm(trimmed)}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

function canEditPricing(role: ControlCenterRole["role"]): boolean {
  if (role === "lab_user") return false;
  const perms = ROLE_PERMISSIONS[role as AdminRole] ?? [];
  return perms.includes("*") || perms.includes("invoices") || perms.includes("orders");
}

function hasCap(role: ControlCenterRole["role"], cap: AdminCapability): boolean {
  if (role === "lab_user") return false;
  return adminHas(role, cap);
}

// ─── FinanceTab ──────────────────────────────────────────────────────────────

export function FinanceTab({ order, role, ref }: {
  order: Order; role: ControlCenterRole; ref: { actor: OrderEvent["actor"]; actorName?: string };
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
