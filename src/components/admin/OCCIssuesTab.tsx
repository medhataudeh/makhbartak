"use client";
import { useState } from "react";
import { AlertTriangle, RotateCcw, Plus } from "lucide-react";
import type { Order, OrderEvent, LabIssueType } from "@/lib/types";
import { FAILED_COLLECTION_REASONS, LAB_ISSUE_REASONS } from "@/lib/mock-data";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { setOrderStatus, openLabIssue, resolveLabIssue } from "@/lib/store";
import type { ControlCenterRole } from "@/components/admin/OrderControlCenter";

// U4.B: extracted from OrderControlCenter.tsx without behavioural change.
// State (labType / labDesc / failedReason / resolveTarget) stays inside
// this function — same as in the parent today; not lifted, not pushed
// down. Mutator signatures unchanged. Activity-log calls unchanged
// (IssuesTab today emits no `record(...)` directly; the mutators write
// their own history rows server-side).
//
// Per the U4.B contract:
//   * No shared helper extraction yet.
//   * No ReasonSheet shared module.
// → Card / Pill / ReasonSheet are duplicated locally below. The OCC
// parent's identical-body copies stay in place for the remaining tabs
// (StickyHeader, OperationsTab, FinanceTab) that still use them. Future
// de-duplication is a separate cleanup phase.

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

function Pill({
  children,
  color = "gray",
}: {
  children: React.ReactNode;
  color?: "gray" | "green" | "red" | "amber" | "cyan" | "purple";
}) {
  const palette: Record<string, string> = {
    gray:   "bg-gray-100 text-gray-600",
    green:  "bg-emerald-50 text-emerald-700",
    red:    "bg-rose-50 text-rose-700",
    amber:  "bg-amber-50 text-amber-700",
    cyan:   "bg-cyan-50 text-cyan-700",
    purple: "bg-purple-50 text-purple-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${palette[color]}`}>
      {children}
    </span>
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

// ─── IssuesTab ───────────────────────────────────────────────────────────────

export function IssuesTab({ order, role, ref }: {
  order: Order; role: ControlCenterRole; ref: { actor: OrderEvent["actor"]; actorName?: string };
}) {
  const [labType, setLabType] = useState<LabIssueType>("invalid_sample");
  const [labDesc, setLabDesc] = useState("");
  const [failedReason, setFailedReason] = useState(order.failedReason ?? "");
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);

  const issues = order.issues ?? [];

  return (
    <div className="space-y-4">
      {/* Failed collection (admin/nurse-side info) */}
      {role.role !== "lab_user" && (
        <Card title="فشل في أخذ العينة" icon={<AlertTriangle size={14} aria-hidden="true" />}>
          <select
            value={failedReason}
            onChange={(e) => setFailedReason(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
            aria-label="سبب الفشل"
          >
            <option value="">— لا يوجد —</option>
            {FAILED_COLLECTION_REASONS.map((r) => <option key={r.value} value={r.value}>{r.labelAr}</option>)}
          </select>
          {failedReason && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => {
              setOrderStatus(order.id, "failed_to_collect", ref, failedReason);
            }}>
              تعليم تعذّر الأخذ
            </Button>
          )}
        </Card>
      )}

      {/* Open lab issue */}
      <Card title="فتح مشكلة في المخبر" icon={<AlertTriangle size={14} aria-hidden="true" />}>
        <div className="space-y-2">
          <select
            value={labType}
            onChange={(e) => setLabType(e.target.value as LabIssueType)}
            className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
            aria-label="نوع المشكلة"
          >
            {LAB_ISSUE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.labelAr}</option>)}
          </select>
          <textarea
            value={labDesc}
            onChange={(e) => setLabDesc(e.target.value)}
            rows={2}
            placeholder="وصف المشكلة"
            className="w-full p-2.5 rounded-lg border border-gray-200 text-xs resize-none focus:border-[#0891B2] outline-none"
          />
          <Button size="sm" variant="primary" disabled={!labDesc.trim()} onClick={() => {
            openLabIssue({
              orderId: order.id,
              labId: order.labId ?? "lab-1",
              type: labType,
              description: labDesc.trim(),
              createdBy: ref.actorName ?? "—",
              createdByRole: role.role === "lab_user" ? "lab" : "admin",
            });
            setLabDesc("");
          }}>
            <Plus size={13} aria-hidden="true" />
            فتح المشكلة
          </Button>
        </div>
      </Card>

      {/* Existing issues */}
      <Card title={`المشاكل المسجّلة (${issues.length})`} icon={<AlertTriangle size={14} aria-hidden="true" />}>
        {issues.length === 0 ? (
          <p className="text-xs text-gray-400 py-1">لا توجد مشاكل</p>
        ) : (
          <ul className="space-y-2">
            {issues.map((i) => (
              <li key={i.id} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-bold text-[#164E63]">{LAB_ISSUE_REASONS.find((r) => r.value === i.type)?.labelAr ?? i.type}</p>
                  <Pill color={i.status === "resolved" ? "green" : "amber"}>{i.status === "resolved" ? "محلولة" : "مفتوحة"}</Pill>
                </div>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{i.description}</p>
                {i.status !== "resolved" && role.role !== "lab_user" && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setResolveTarget(i.id)}>
                    <RotateCcw size={12} aria-hidden="true" />
                    حل المشكلة
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ReasonSheet
        open={resolveTarget !== null}
        title="حل المشكلة"
        placeholder="ملاحظة الحل (اختيارية)"
        confirmLabel="تأكيد الحل"
        onCancel={() => setResolveTarget(null)}
        onConfirm={(note) => {
          const id = resolveTarget;
          setResolveTarget(null);
          if (id !== null) resolveLabIssue(id, note, ref);
        }}
      />
    </div>
  );
}
