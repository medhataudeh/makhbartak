"use client";
import { useState } from "react";
import {
  X, MapPin, User, Clock, Calendar,
  CheckCircle2, Tag, CreditCard, Send, Download, ChevronDown, RefreshCw,
} from "lucide-react";
import type {
  Order, Nurse, Lab,
  AdminRole,
} from "@/lib/types";
import { adminHas, type AdminCapability } from "@/lib/admin-permissions";
import { formatDate, formatPrice, getShiftLabel } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  setOrderStatus, applyCoupon, setPaymentStatus,
  cancelOrder, rescheduleOrder,
} from "@/lib/store";
import { logActivity } from "@/lib/activity-log";
import { apiValidateCoupon } from "@/lib/admin-catalog-api";
import { useToast } from "@/components/ui/Toast";
import type { ControlCenterRole } from "@/components/admin/OrderControlCenter";

// U4.E: extracted from OrderControlCenter.tsx without behavioural change.
// State (5 sheet-open slots) stays inside this function — same as in the
// parent today; not lifted, not pushed down. Mutator signatures unchanged.
// Activity-log calls (`record`) preserved verbatim with the same call
// sites and details strings as the prompt era.
//
// Per the U4.E contract this file holds the StickyHeader plus its sole-
// consumer helpers — `record`, `Pill`, `ActionItem`, `ReasonSheet`,
// `DateSheet`, `StatusPickerSheet`, `CouponSheet`, `hasCap` — which had
// no remaining consumers in the parent after U4.A–D, so they move along
// with their callsite rather than being duplicated. This is not "shared
// sheet infrastructure extraction"; the helpers are private to this
// file.

// ─── Sticky header with role-gated quick actions ──────────────────────────────
export function StickyHeader({ order, role, onClose, onOpenUser }: {
  order: Order; role: ControlCenterRole; nurses: Nurse[]; labs: Lab[]; onClose: () => void;
  onOpenUser?: (userId: string) => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [statusFlipOpen, setStatusFlipOpen] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const ref = { actor: role.actor, actorName: role.actorName };
  const isLab = role.role === "lab_user";
  const toast = useToast();

  return (
    <header className="px-4 md:px-5 py-3 border-b border-gray-100 bg-white flex-shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Public number — primary identifier; internal id stays available
                next to it for cross-system reference. */}
            {order.publicNumber && (
              <span className="text-sm font-bold text-[#164E63] lat" dir="ltr">{order.publicNumber}</span>
            )}
            <span className="text-[11px] text-gray-400 lat" dir="ltr">· {order.id}</span>
            <StatusBadge status={order.status} />
            {order.paymentStatus === "paid" && <Pill color="green">مدفوع</Pill>}
            {order.paymentStatus === "pending" && <Pill color="amber">دفع معلّق</Pill>}
            {order.paymentStatus === "failed" && <Pill color="red">فشل الدفع</Pill>}
          </div>
          <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" />{order.address.city}</span>
            <span className="inline-flex items-center gap-1"><Calendar size={11} aria-hidden="true" />{formatDate(order.visitDate)}</span>
            <span className="inline-flex items-center gap-1"><Clock size={11} aria-hidden="true" />{getShiftLabel(order.shift)}</span>
            <span className="font-bold text-[#164E63]">{formatPrice(order.total)}</span>
            {onOpenUser && !isLab && (
              <button
                onClick={() => onOpenUser(order.userId)}
                className="inline-flex items-center gap-1 text-[#0891B2] font-semibold cursor-pointer"
              >
                <User size={11} aria-hidden="true" />
                {order.patient.name}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative">
            <button
              onClick={() => setActionsOpen((v) => !v)}
              className="h-9 px-3 rounded-xl bg-[#ECFEFF] text-[#0891B2] text-xs font-semibold flex items-center gap-1 cursor-pointer active:bg-cyan-100"
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
            >
              إجراءات سريعة
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {actionsOpen && (
              <div role="menu" className="absolute end-0 mt-1 w-64 bg-white rounded-xl border border-gray-100 shadow-lg z-10 py-1">
                {!isLab && (
                  <>
                    {/* Nurse + lab assignment is intentionally NOT in this
                       quick-actions menu anymore. Use the dropdowns under
                       the "Operations" tab — they read real DB rows so the
                       admin can never accidentally submit a stale id. */}
                    <ActionItem icon={RefreshCw} label="إعادة جدولة" onClick={() => {
                      setActionsOpen(false);
                      setRescheduleOpen(true);
                    }} />
                    {hasCap(role.role, "finance.coupon") && (
                      <ActionItem icon={Tag} label="تطبيق/إزالة كوبون" onClick={() => {
                        setActionsOpen(false);
                        setCouponOpen(true);
                      }} />
                    )}
                    {/* Phase 4.1.1: 'paid' transitions go through the cash-payment
                        RPC (separate menu item below). This sheet handles the
                        operational pending/failed/refunded transitions only;
                        the StatusPickerSheet redirects "paid" requests to the
                        record-cash flow with the same toast as before. */}
                    <ActionItem icon={CreditCard} label="تغيير حالة الدفع" onClick={() => {
                      setActionsOpen(false);
                      setStatusFlipOpen(true);
                    }} />
                    <hr className="my-1 border-gray-100" />
                  </>
                )}
                <ActionItem icon={CheckCircle2} label="تعليم النتيجة جاهزة" onClick={() => {
                  setOrderStatus(order.id, "result_ready", ref);
                  record(role, "order_update", "order", order.id, "تعليم النتيجة جاهزة");
                  setActionsOpen(false);
                }} />
                <ActionItem icon={Send} label="تعليم مكتمل" onClick={() => {
                  setOrderStatus(order.id, "completed", ref);
                  record(role, "order_update", "order", order.id, "تعليم مكتمل");
                  setActionsOpen(false);
                }} />
                {!isLab && (
                  <>
                    <hr className="my-1 border-gray-100" />
                    <ActionItem icon={Download} label="عرض/تنزيل الفاتورة" onClick={() => { window.print(); setActionsOpen(false); }} />
                    {hasCap(role.role, "operations.cancel") && (
                      <ActionItem icon={X} label="إلغاء الطلب" danger onClick={() => {
                        setActionsOpen(false);
                        setCancelOpen(true);
                      }} />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <ReasonSheet
        open={cancelOpen}
        title="إلغاء الطلب"
        placeholder="سبب الإلغاء (اختياري)"
        confirmLabel="تأكيد الإلغاء"
        variant="danger"
        onCancel={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          setCancelOpen(false);
          const r = await cancelOrder(order.id, ref, reason || undefined);
          if (!r.ok) toast.error(r.error ?? "تعذر إلغاء الطلب");
          else record(role, "order_update", "order", order.id, `إلغاء الطلب${reason ? ` — ${reason}` : ""}`);
        }}
      />
      <DateSheet
        open={rescheduleOpen}
        title="إعادة جدولة الطلب"
        initialValue={order.visitDate}
        confirmLabel="تأكيد"
        onCancel={() => setRescheduleOpen(false)}
        onConfirm={async (date) => {
          setRescheduleOpen(false);
          const r = await rescheduleOrder(order.id, date, order.shift, ref);
          if (!r.ok) toast.error(r.error ?? "تعذر إعادة الجدولة");
          else record(role, "order_update", "order", order.id, `إعادة جدولة → ${date}`);
        }}
      />
      <StatusPickerSheet
        open={statusFlipOpen}
        title="تغيير حالة الدفع"
        current={order.paymentStatus}
        onCancel={() => setStatusFlipOpen(false)}
        onPick={async (next) => {
          setStatusFlipOpen(false);
          const r = await setPaymentStatus(order.id, next, ref);
          if (!r.ok) toast.error(r.error ?? "تعذر تغيير حالة الدفع");
          else record(role, "invoice_status", "order", order.id, `حالة الدفع → ${next}`);
        }}
        onPickPaid={() => {
          // Same redirect message as the prior prompt era.
          toast.error("استخدم زر «تسجيل تحصيل نقدي» في الملخص المالي.");
        }}
      />
      <CouponSheet
        open={couponOpen}
        initialCode={order.couponCode ?? ""}
        initialDiscount={order.couponDiscount ?? 0}
        subtotal={order.subtotal}
        onCancel={() => setCouponOpen(false)}
        onConfirm={async (code, disc) => {
          setCouponOpen(false);
          // Mutator payload byte-identical to the prompt era:
          //   * empty code  → applyCoupon(id, "", 0, ref)            // remove
          //   * non-empty   → applyCoupon(id, code, <admin's disc>)  // apply / override
          // The admin's typed discount is the source of truth at the
          // mutator boundary regardless of the SSoT validation outcome —
          // exactly the prompt-era contract.
          const r = await applyCoupon(order.id, code, disc, ref);
          if (!r.ok) toast.error(r.error ?? "تعذر تحديث الكوبون");
          else record(role, "coupon_change", "order", order.id, code ? `${code} -${disc}` : "إزالة الكوبون");
        }}
      />
    </header>
  );
}

// ─── Local helpers ────────────────────────────────────────────────────────────
function record(role: ControlCenterRole, action: import("@/lib/types").ActivityAction, entity: string, entityId: string, details: string) {
  if (!role.adminId || role.role === "lab_user") return;
  logActivity({
    adminId: role.adminId,
    adminName: role.actorName,
    role: role.role as AdminRole,
    action, entity, entityId, details,
  });
}

// Capability gate for buttons whose backend route is now sub-role enforced.
// Lab users always fail; everything else delegates to the canonical matrix.
function hasCap(role: ControlCenterRole["role"], cap: AdminCapability): boolean {
  if (role === "lab_user") return false;
  return adminHas(role, cap);
}

function Pill({ children, color = "gray" }: { children: React.ReactNode; color?: "gray" | "green" | "red" | "amber" | "cyan" | "purple" }) {
  const map = {
    gray:   "bg-gray-100 text-gray-600",
    green:  "bg-emerald-50 text-emerald-700",
    red:    "bg-red-50 text-red-600",
    amber:  "bg-amber-50 text-amber-700",
    cyan:   "bg-cyan-50 text-cyan-700",
    purple: "bg-purple-50 text-purple-700",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[color]}`}>{children}</span>;
}

function ActionItem({ icon: Icon, label, onClick, danger }: {
  icon: React.FC<{ size?: number; className?: string }>; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer text-start ${
        danger ? "text-red-600 hover:bg-red-50" : "text-[#164E63] hover:bg-gray-50"
      }`}
    >
      <Icon size={14} className={danger ? "text-red-500" : "text-gray-400"} />
      {label}
    </button>
  );
}

// ─── ReasonSheet ─────────────────────────────────────────────────────────────
// U3.A: typed BottomSheet replacement for the legacy `window.prompt` flows
// that collect a free-text reason before invoking a mutator. Reuses the
// existing BottomSheet primitive — no new modal framework. Each callsite
// owns its own `open` state and decides whether `required` matches the
// previous prompt's behaviour:
//   * cancel reason          — optional (cancelOrder accepts undefined)
//   * force-complete reason  — required (force_complete_order_admin RPC
//                              raises without a non-empty reason)
//   * refund reason          — optional + currently discarded by the
//                              mutator (preserved exactly: setPaymentStatus
//                              has no reason argument; reason is captured
//                              for UX consistency with the prior prompt)
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
  /** When false, render a single-line <input type="text"> instead of a
   *  multiline <textarea>. Used by U3.B's filename callsite where a short
   *  identifier is the right input shape. Defaults to true to preserve
   *  the U3.A callsites' existing multiline behaviour. */
  multiline?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  initialValue?: string;
  variant?: "primary" | "danger";
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  // Render-time state-sync: reset on every false → true transition so a
  // stale value from the prior session isn't sticky. Same pattern used by
  // CommissionField / StripeKeyField in this file's siblings — avoids the
  // useEffect+setState pattern that React 19 flags via
  // `react-hooks/set-state-in-effect`.
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

// ─── DateSheet ────────────────────────────────────────────────────────────────
// U3.B: typed BottomSheet replacement for `window.prompt("…YYYY-MM-DD…", default)`.
// Uses the native <input type="date"> picker so the browser enforces the
// YYYY-MM-DD shape on the way in. The route's DATE_RE regex still gates
// server-side, so the mutator payload + API contract are unchanged from the
// prompt era; this is a UX tightening (impossible-to-mistype) only.
function DateSheet({
  open,
  title,
  initialValue,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  initialValue: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (date: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setValue(initialValue);
  }
  // Native <input type="date"> emits "" on a cleared field and a
  // YYYY-MM-DD string otherwise. Confirm only when the value is non-empty
  // — matches today's `if (date)` guard exactly.
  const canSubmit = value.length > 0;
  return (
    <BottomSheet open={open} onClose={onCancel} title={title}>
      <div className="space-y-3 px-4 pb-4">
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none lat"
          dir="ltr"
          aria-label={title}
          autoFocus
        />
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button size="sm" variant="primary" disabled={!canSubmit} onClick={() => onConfirm(value)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

// ─── StatusPickerSheet ────────────────────────────────────────────────────────
// U3.B: typed BottomSheet replacement for the legacy free-text payment-
// status enum prompt. Today's flow asks the admin to type one of three
// strings ("pending"/"failed"/"refunded") with a soft hint about "paid".
// The new sheet renders three explicit buttons — same valid set, same
// helper text for the "paid" case, no free-text path that could submit
// anything outside the enum.
function StatusPickerSheet({
  open,
  title,
  current,
  onPick,
  onPickPaid,
  onCancel,
}: {
  open: boolean;
  title: string;
  current: string;
  onPick: (next: "pending" | "failed" | "refunded") => void;
  /** Fired when the admin clicks the disabled "paid" hint, mirroring the
   *  prior toast that redirected them to the record-cash flow. */
  onPickPaid: () => void;
  onCancel: () => void;
}) {
  const OPTIONS: { value: "pending" | "failed" | "refunded"; labelAr: string; hint?: string }[] = [
    { value: "pending",  labelAr: "قيد الانتظار", hint: "بانتظار التحصيل" },
    { value: "failed",   labelAr: "فاشل",         hint: "تعذّر تحصيل المبلغ" },
    { value: "refunded", labelAr: "مُسترَد",      hint: "تم إعادة المبلغ" },
  ];
  return (
    <BottomSheet open={open} onClose={onCancel} title={title}>
      <div className="space-y-2 px-4 pb-4">
        <p className="text-[11px] text-gray-400">الحالة الحالية: <span className="lat" dir="ltr">{current}</span></p>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => onPick(o.value)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-gray-200 text-sm cursor-pointer hover:bg-gray-50 text-start"
          >
            <span className="font-semibold text-[#164E63]">{o.labelAr}</span>
            <span className="text-[11px] text-gray-400">{o.hint}</span>
          </button>
        ))}
        <button
          onClick={onPickPaid}
          className="w-full text-[11px] text-amber-600 px-3 py-2 rounded-xl bg-amber-50 cursor-pointer text-start"
        >
          لتعليم الطلب كمدفوع، استخدم زر «تسجيل تحصيل نقدي» من الملخص المالي.
        </button>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>إلغاء</Button>
        </div>
      </div>
    </BottomSheet>
  );
}

// ─── CouponSheet ──────────────────────────────────────────────────────────────
// U3.C: typed BottomSheet replacement for the legacy two-step
// `window.prompt("كود الكوبون") → window.prompt("قيمة الخصم")` flow.
//
// Validation flow goes through the centralized Coupon SSoT route
// /api/coupons/validate (mounted on `validateCouponServer` in
// lib/server/coupons.ts) via the existing apiValidateCoupon helper. This
// component does NOT re-implement coupon math, date checks, usage caps,
// or min-order rules — it consumes the canonical validation result.
//
// Override semantics — preserved exactly:
//   * The discount field is always editable.
//   * On a successful "تحقق" (verify), the field is pre-filled with the
//     SSoT-computed discount IF the admin hasn't typed in it yet. Once
//     the admin manually edits the field (`discountUserEdited` flips
//     true), subsequent verify clicks no longer overwrite the field.
//   * Validation never blocks submit. The admin's typed value is the
//     source of truth at the mutator boundary, identical to the
//     prompt-era behaviour.
//
// Mutator payload parity:
//   * Empty code  →  applyCoupon(orderId, "", 0, ref)            // remove
//   * Non-empty   →  applyCoupon(orderId, code, Number(field) || 0, ref)
function CouponSheet({
  open,
  initialCode,
  initialDiscount,
  subtotal,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  initialCode: string;
  initialDiscount: number;
  /** Authoritative subtotal passed to /api/coupons/validate as the SSoT
   *  module's `subtotal` parameter. Order subtotal in this codebase is
   *  the field the cart and admin order-create routes both use. */
  subtotal: number;
  onCancel: () => void;
  onConfirm: (code: string, discount: number) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [discount, setDiscount] = useState<string>(String(initialDiscount || 0));
  const [discountUserEdited, setDiscountUserEdited] = useState(false);
  const [validating, setValidating] = useState(false);
  type Result =
    | { kind: "idle" }
    | { kind: "ok"; message: string; suggestedDiscount: number }
    | { kind: "invalid"; message: string }
    | { kind: "error"; message: string };
  const [result, setResult] = useState<Result>({ kind: "idle" });

  // Render-time state-sync (same pattern as the U3.A/B sheets) — reset
  // every time the sheet opens so a stale value from the prior session
  // isn't sticky.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setCode(initialCode);
      setDiscount(String(initialDiscount || 0));
      setDiscountUserEdited(false);
      setResult({ kind: "idle" });
    }
  }

  const verify = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setValidating(true);
    try {
      const r = await apiValidateCoupon(trimmed, subtotal);
      if (r.valid && typeof r.discount === "number") {
        setResult({ kind: "ok", message: r.message, suggestedDiscount: r.discount });
        // Pre-fill the discount field ONLY if the admin hasn't typed in
        // it yet. Manual edits stay sticky — preserves the override
        // contract exactly.
        if (!discountUserEdited) {
          setDiscount(String(r.discount));
        }
      } else {
        setResult({ kind: "invalid", message: r.message ?? "الكوبون غير صالح" });
      }
    } catch {
      // apiValidateCoupon already returns a fallback on network errors;
      // catching here is belt-and-suspenders.
      setResult({ kind: "error", message: "تعذر التحقق من الكوبون" });
    } finally {
      setValidating(false);
    }
  };

  const trimmedCode = code.trim();
  const willRemove = trimmedCode === "";
  // Discount sent to the mutator. Today's prompt era used
  // `code ? Number(disc || 0) : 0`; we mirror that exactly: when removing,
  // 0; when applying, the field's number value (NaN coerces to 0 via
  // Number.isFinite check).
  const numericDiscount = Number(discount);
  const discountForSubmit = willRemove ? 0 : (Number.isFinite(numericDiscount) ? numericDiscount : 0);

  return (
    <BottomSheet open={open} onClose={onCancel} title="تطبيق/إزالة كوبون">
      <div className="space-y-3 px-4 pb-4">
        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">كود الكوبون</label>
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                // Clear stale validation feedback when the code changes.
                if (result.kind !== "idle") setResult({ kind: "idle" });
              }}
              placeholder="WELCOME30 — اتركه فارغاً للإزالة"
              className="flex-1 h-11 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none lat"
              dir="ltr"
              aria-label="كود الكوبون"
              autoFocus
            />
            <Button
              size="sm"
              variant="outline"
              loading={validating}
              disabled={!trimmedCode || validating}
              onClick={verify}
            >تحقق</Button>
          </div>
          {result.kind === "ok" && (
            <p className="text-[11px] mt-1.5 text-emerald-600">
              {result.message} — الخصم المقترح: {result.suggestedDiscount}
            </p>
          )}
          {result.kind === "invalid" && (
            <p className="text-[11px] mt-1.5 text-rose-600">{result.message}</p>
          )}
          {result.kind === "error" && (
            <p className="text-[11px] mt-1.5 text-gray-500">{result.message}</p>
          )}
        </div>

        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">قيمة الخصم (يمكنك تعديلها)</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={discount}
            onChange={(e) => {
              setDiscount(e.target.value);
              setDiscountUserEdited(true);
            }}
            disabled={willRemove}
            className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none lat disabled:bg-gray-50 disabled:text-gray-400"
            dir="ltr"
            aria-label="قيمة الخصم"
          />
          {willRemove && (
            <p className="text-[11px] mt-1.5 text-gray-400">
              ترك الكود فارغاً يزيل الكوبون من الطلب.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>إلغاء</Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => onConfirm(trimmedCode, discountForSubmit)}
          >
            {willRemove ? "إزالة الكوبون" : "حفظ"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
