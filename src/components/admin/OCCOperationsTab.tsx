"use client";
import { useState } from "react";
import {
  UserCog, Building2, FileText, Upload, Trash2, CheckCircle2,
} from "lucide-react";
import type { Order, Nurse, Lab, OrderEvent } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  assignNurse, assignLab, archiveResultFile, restoreResultFile,
  confirmResultsReady, forceCompleteOrder, uploadResultFile,
} from "@/lib/store";
import { useToast } from "@/components/ui/Toast";
import { adminHas, type AdminCapability } from "@/lib/admin-permissions";
import type { ControlCenterRole } from "@/components/admin/OrderControlCenter";

// U4.D: extracted from OrderControlCenter.tsx without behavioural change.
// State (forceCompleteOpen / uploadNameOpen) stays inside this function —
// same as in the parent today; not lifted, not pushed down. Mutator
// signatures unchanged. Cap gate (operations.force_complete) preserved.
//
// Per the U4.D contract:
//   * No shared helper extraction yet.
//   * No ReasonSheet shared module.
// → Card / Row / ReasonSheet are duplicated locally below. The OCC
// parent's identical-body copies stay in place for the remaining tabs
// (StickyHeader, FinanceTab) that still use them.

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

function hasCap(role: ControlCenterRole["role"], cap: AdminCapability): boolean {
  if (role === "lab_user") return false;
  return adminHas(role, cap);
}

// ─── OperationsTab ───────────────────────────────────────────────────────────

export function OperationsTab({ order, role, nurses, labs, ref }: {
  order: Order; role: ControlCenterRole; nurses: Nurse[]; labs: Lab[]; ref: { actor: OrderEvent["actor"]; actorName?: string };
}) {
  const toast = useToast();
  const isLab = role.role === "lab_user";
  const nurse = nurses.find((n) => n.id === order.nurseId);
  const lab = labs.find((l) => l.id === order.labId);
  const allFiles = order.resultFiles ?? [];
  const activeFiles = allFiles.filter((f) => f.isActive);
  const archivedFiles = allFiles.filter((f) => !f.isActive);
  const [forceCompleteOpen, setForceCompleteOpen] = useState(false);
  const [uploadNameOpen, setUploadNameOpen] = useState(false);


  return (
    <div className="space-y-3">
      {/* Nurse */}
      <Card title="الممرض" icon={<UserCog size={14} aria-hidden="true" />}>
        <Row label="المعيّن" value={nurse?.name ?? "—"} />
        <Row label="حالة الزيارة" value={order.status} />
        {!isLab && (
          <div className="flex flex-wrap gap-2 pt-2">
            <select
              value={order.nurseId ?? ""}
              onChange={async (e) => {
                if (!e.target.value) return;
                const r = await assignNurse(order.id, e.target.value, ref);
                if (!r.ok) toast.error(r.error ?? "تعذر تعيين الممرض");
              }}
              className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
              aria-label="إسناد ممرض"
            >
              <option value="">— غير معيّن —</option>
              {nurses.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </div>
        )}
      </Card>

      {/* Lab */}
      <Card title="المخبر" icon={<Building2 size={14} aria-hidden="true" />}>
        <Row label="المعيّن" value={lab?.nameAr ?? lab?.name ?? "—"} />
        <Row label="مدة المعالجة المتوقعة" value={lab?.avgProcessingHours ? `${lab.avgProcessingHours} ساعات` : "—"} />
        {!isLab && (
          <div className="flex flex-wrap gap-2 pt-2">
            <select
              value={order.labId ?? ""}
              onChange={async (e) => {
                if (!e.target.value) return;
                const r = await assignLab(order.id, e.target.value, ref);
                if (!r.ok) toast.error(r.error ?? "تعذر تعيين المخبر");
              }}
              className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
              aria-label="إسناد مخبر"
            >
              <option value="">— غير معيّن —</option>
              {labs.map((l) => <option key={l.id} value={l.id}>{l.nameAr ?? l.name}</option>)}
            </select>
          </div>
        )}
      </Card>

      {/* Result files */}
      <Card title="ملفات النتائج" icon={<FileText size={14} aria-hidden="true" />} action={
        <button
          onClick={() => setUploadNameOpen(true)}
          className="text-xs px-2.5 py-1 rounded-md bg-[#ECFEFF] text-[#0891B2] cursor-pointer flex items-center gap-1"
        >
          <Upload size={12} aria-hidden="true" /> رفع PDF
        </button>
      }>
        {activeFiles.length === 0 && archivedFiles.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">لم يُرفع أي ملف بعد</p>
        ) : (
          <ul className="space-y-2">
            {activeFiles.map((f) => (
              <li key={f.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-2.5">
                <FileText size={15} className="text-red-500" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#164E63] truncate">{f.fileName}</p>
                  <p className="text-[10px] text-gray-500">{f.uploadedBy} · {formatDate(f.uploadedAt)}</p>
                </div>
                <button
                  onClick={() => archiveResultFile(order.id, f.id, { actor: role.role === "lab_user" ? "lab" : "admin", actorName: ref.actorName ?? "—" })}
                  aria-label="أرشفة"
                  title="أرشفة (لا يُحذف نهائياً)"
                  className="w-7 h-7 rounded-md hover:bg-amber-50 flex items-center justify-center cursor-pointer"
                >
                  <Trash2 size={12} className="text-red-400" aria-hidden="true" />
                </button>
              </li>
            ))}
            {archivedFiles.length > 0 && (
              <li className="pt-2">
                <p className="text-[10px] text-gray-400 mb-1">مؤرشف (يبقى للمراجعة، لا يظهر للعميل)</p>
                <ul className="space-y-1.5">
                  {archivedFiles.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-2.5 opacity-50">
                      <FileText size={15} className="text-gray-400" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-500 truncate line-through">{f.fileName}</p>
                        <p className="text-[10px] text-gray-400">أُرشفت {f.archivedAt ? formatDate(f.archivedAt) : "—"} {f.archivedBy ? `· ${f.archivedBy}` : ""}</p>
                      </div>
                      <button
                        onClick={() => restoreResultFile(order.id, f.id, { actor: role.role === "lab_user" ? "lab" : "admin", actorName: ref.actorName ?? "—" })}
                        className="text-[10px] px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 cursor-pointer"
                      >
                        استعادة
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ul>
        )}

        {/* Confirm + auto-complete */}
        {!isLab && order.status !== "completed" && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm" variant="primary"
              disabled={activeFiles.length === 0}
              onClick={async () => {
                const r = await confirmResultsReady(order.id, ref);
                if (!r.ok) toast.error(r.error ?? "تعذر تأكيد إرسال النتائج");
                else toast.success("اكتمل الطلب");
              }}
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              تأكيد إرسال النتائج (إكمال الطلب)
            </Button>
            {hasCap(role.role, "operations.force_complete") && (
              <Button
                size="sm" variant="ghost"
                onClick={() => setForceCompleteOpen(true)}
              >
                إغلاق دون نتائج
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* File activity log */}
      {(order.fileEvents?.length ?? 0) > 0 && (
        <Card title="سجل ملفات الطلب" icon={<FileText size={14} aria-hidden="true" />}>
          <ol className="space-y-2">
            {[...(order.fileEvents ?? [])].reverse().map((ev) => (
              <li key={ev.id} className="text-[11px] text-[#164E63]">
                <span className="font-semibold">
                  {ev.type === "uploaded" ? "رفع" :
                   ev.type === "replaced" ? "استبدال" :
                   ev.type === "restored" ? "استعادة" :
                                            "أرشفة"}
                </span>
                {" — "}<span className="text-gray-500">{ev.fileName}</span>
                <span className="text-gray-400"> · {ev.actorName} · {formatDate(ev.createdAt)}</span>
                {ev.note && <p className="text-[11px] text-gray-400 mt-0.5">{ev.note}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <ReasonSheet
        open={forceCompleteOpen}
        title="إغلاق دون نتائج"
        placeholder="سبب الإغلاق دون نتائج (مطلوب)"
        required
        confirmLabel="إغلاق الطلب"
        variant="danger"
        onCancel={() => setForceCompleteOpen(false)}
        onConfirm={async (reason) => {
          setForceCompleteOpen(false);
          const r = await forceCompleteOrder(order.id, ref, reason);
          if (!r.ok) toast.error(r.error ?? "تعذر إغلاق الطلب");
        }}
      />
      <ReasonSheet
        open={uploadNameOpen}
        title="رفع PDF"
        placeholder="اسم الملف"
        multiline={false}
        required
        confirmLabel="رفع"
        initialValue={`${order.id}-result.pdf`}
        onCancel={() => setUploadNameOpen(false)}
        onConfirm={(name) => {
          setUploadNameOpen(false);
          uploadResultFile(order.id, {
            labId: order.labId ?? "lab-1",
            fileUrl: `/results/${order.id}/${name}`,
            fileName: name,
            uploadedBy: ref.actorName ?? "—",
          });
        }}
      />
    </div>
  );
}
