"use client";
import { useState } from "react";
import type { OrderEvent } from "@/lib/types";
import { adminHas, type AdminCapability } from "@/lib/admin-permissions";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { ControlCenterRole } from "@/components/admin/OrderControlCenter";

// U4.F.1 — shared OCC helpers consolidated from byte-identical local
// duplicates across the OCC sibling files. Extraction happened only
// AFTER every consumer was extracted (U4.A–E), per the
// "extraction-before-abstraction" rule in CLAUDE.md.
//
// Intentionally NOT shared (see CLAUDE.md "OCC drift"):
//   * Row  — diverged between parent OverviewTab and tab bodies.
//   * Pill — diverged between StickyHeader and IssuesTab.
// These divergences are visual semantics, not duplication. Any
// unification is a UX call deferred to a future visual-consistency
// pass.

// ─── OrderActorRef ───────────────────────────────────────────────────────────
// The `ref` shape that every order mutator (cancelOrder, applyCoupon,
// recordAdminCashPayment, addNote, etc.) requires for activity-log
// stamping. Was inlined in 3 OCC tab prop types pre-U4.F.1.
export type OrderActorRef = {
  actor: OrderEvent["actor"];
  actorName?: string;
};

// ─── hasCap ──────────────────────────────────────────────────────────────────
// Capability gate for buttons whose backend route is sub-role
// enforced. Lab users always fail; everything else delegates to the
// canonical matrix in admin-permissions.ts.
export function hasCap(role: ControlCenterRole["role"], cap: AdminCapability): boolean {
  if (role === "lab_user") return false;
  return adminHas(role, cap);
}

// ─── Card ────────────────────────────────────────────────────────────────────
// Section card with bordered header + padded body. Pure presentational;
// no state, no callbacks. Used by every OCC tab body that groups rows
// or content. Body classes are byte-identical to the 5 prior local
// duplicates — visual parity is preserved exactly.
export function Card({
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

// ─── ReasonSheet ─────────────────────────────────────────────────────────────
// Typed BottomSheet replacement for the legacy `window.prompt` flows
// that collect a free-text reason / value before invoking a mutator.
// Reuses the existing BottomSheet primitive — no new modal framework.
//
// Render-time state-sync via `wasOpen` is LOAD-BEARING: it resets
// `value` on every false→true transition so a stale value from a prior
// session isn't sticky. This pattern matches `CommissionField` /
// `StripeKeyField` in admin sibling files and avoids the
// useEffect+setState pattern that React 19 flags via
// `react-hooks/set-state-in-effect`. Do NOT replace with useEffect.
//
// Each callsite owns its own `open` state and decides whether
// `required` matches the previous prompt's behaviour:
//   * cancel reason          — optional (cancelOrder accepts undefined)
//   * force-complete reason  — required (force_complete_order_admin RPC
//                              raises without a non-empty reason)
//   * refund reason          — optional + currently discarded by the
//                              mutator (preserved exactly: setPaymentStatus
//                              has no reason argument; reason is captured
//                              for UX consistency with the prior prompt)
//   * upload filename        — required, single-line (multiline=false)
export function ReasonSheet({
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
   *  multiline <textarea>. Used by the upload-filename callsite where a
   *  short identifier is the right input shape. Defaults to true to
   *  preserve the U3.A callsites' existing multiline behaviour. */
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
