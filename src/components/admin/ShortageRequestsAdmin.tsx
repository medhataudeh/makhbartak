"use client";
import { useState } from "react";
import { ChevronLeft, AlertCircle, Save } from "lucide-react";
import type { AdminRole, NurseToolShortageRequest, NurseToolShortageStatus } from "@/lib/types";
import { NURSE_SHORTAGE_STATUS_LABELS } from "@/lib/types";
import {
  useShortageRequests, useShortageItems, setShortageRequestStatus, updateShortageAdminNote,
} from "@/lib/shortage-requests";
import { logActivity } from "@/lib/activity-log";
import { useToast } from "@/components/ui/Toast";
import { formatDate, relativeTime } from "@/lib/utils";

interface Props {
  adminId: string;
  adminName: string;
  adminRole: AdminRole;
}

const STATUS_PILL: Record<NurseToolShortageStatus, string> = {
  pending:   "bg-amber-50 text-amber-700",
  preparing: "bg-cyan-50 text-cyan-700",
  sent:      "bg-purple-50 text-purple-700",
  resolved:  "bg-emerald-50 text-emerald-700",
  cancelled: "bg-gray-100 text-gray-500",
};

export function ShortageRequestsAdmin({ adminId, adminName, adminRole }: Props) {
  const all = useShortageRequests();
  const [statusFilter, setStatusFilter] = useState<NurseToolShortageStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? all.find((r) => r.id === openId) ?? null : null;

  const filtered = all.filter((r) => statusFilter === "all" || r.status === statusFilter);
  const pendingCount = all.filter((r) => r.status === "pending").length;

  if (open) {
    return (
      <ShortageRequestPanel
        request={open}
        adminId={adminId} adminName={adminName} adminRole={adminRole}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-[#164E63]">طلبات الأدوات</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          الطلبات المرسلة من الممرضين خلال التحضير الصباحي.
          {pendingCount > 0 && <span className="text-amber-700 font-semibold ms-2">{pendingCount} بانتظار المراجعة</span>}
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["all", "pending", "preparing", "sent", "resolved", "cancelled"] as const).map((s) => {
          const active = statusFilter === s;
          const label = s === "all" ? "الكل" : NURSE_SHORTAGE_STATUS_LABELS[s as NurseToolShortageStatus];
          const count = s === "all" ? all.length : all.filter((r) => r.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${active ? "bg-[#0891B2] text-white" : "bg-white border border-gray-200 text-gray-600"}`}
            >
              {label} <span className="opacity-70">· {count}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="text-start py-2 px-3 font-semibold">الممرض</th>
              <th className="text-start py-2 px-3 font-semibold">التاريخ</th>
              <th className="text-start py-2 px-3 font-semibold">الحالة</th>
              <th className="text-start py-2 px-3 font-semibold">الملاحظة</th>
              <th className="text-start py-2 px-3 font-semibold">منذ</th>
              <th className="text-end py-2 px-3 font-semibold">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6 text-xs">لا توجد طلبات</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-gray-50 last:border-0">
                <td className="py-2.5 px-3 text-xs font-semibold text-[#164E63]">{r.nurseName ?? r.nurseId}</td>
                <td className="py-2.5 px-3 text-xs text-gray-500">{formatDate(r.date)}</td>
                <td className="py-2.5 px-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_PILL[r.status]}`}>
                    {NURSE_SHORTAGE_STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-[11px] text-gray-500 line-clamp-1 max-w-[260px]">{r.note || "—"}</td>
                <td className="py-2.5 px-3 text-[11px] text-gray-400">{relativeTime(r.createdAt)}</td>
                <td className="py-2.5 px-3 text-end">
                  <button onClick={() => setOpenId(r.id)} className="text-xs px-2 py-1 rounded-md bg-[#ECFEFF] text-[#0891B2] cursor-pointer">
                    فتح
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShortageRequestPanel({ request, adminId, adminName, adminRole, onBack }: {
  request: NurseToolShortageRequest;
  adminId: string;
  adminName: string;
  adminRole: AdminRole;
  onBack: () => void;
}) {
  const items = useShortageItems(request.id);
  const toast = useToast();
  const [adminNote, setAdminNote] = useState(request.adminNote ?? "");
  const dirty = adminNote !== (request.adminNote ?? "");

  const transition = (status: NurseToolShortageStatus, label: string) => {
    setShortageRequestStatus(request.id, status, dirty ? adminNote : undefined);
    logActivity({
      adminId, adminName, role: adminRole,
      action: "settings_change", entity: "shortage_request", entityId: request.id,
      details: `تحديث حالة طلب أدوات (${request.nurseName ?? request.nurseId}) → ${label}`,
    });
    toast.success("تم تحديث الحالة");
  };

  const saveNote = () => {
    updateShortageAdminNote(request.id, adminNote);
    logActivity({
      adminId, adminName, role: adminRole,
      action: "settings_change", entity: "shortage_request", entityId: request.id,
      details: `تحديث ملاحظة طلب الأدوات`,
    });
    toast.success("تم الحفظ");
  };

  const transitions: { to: NurseToolShortageStatus; label: string; allowed: NurseToolShortageStatus[] }[] = [
    { to: "preparing", label: "قيد التحضير", allowed: ["pending"] },
    { to: "sent",      label: "تم الإرسال",   allowed: ["pending", "preparing"] },
    { to: "resolved",  label: "تم الاستلام",  allowed: ["sent", "preparing"] },
    { to: "cancelled", label: "إلغاء",        allowed: ["pending", "preparing"] },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="رجوع"
          className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer"
        >
          <ChevronLeft size={16} className="rotate-180 text-[#164E63]" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <p className="text-[11px] text-gray-400">طلبات الأدوات</p>
          <h2 className="text-base font-bold text-[#164E63] truncate">طلب من {request.nurseName ?? request.nurseId}</h2>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Row label="الممرض" value={request.nurseName ?? request.nurseId} />
          <Row label="التاريخ" value={formatDate(request.date)} />
          <Row label="الحالة" value={
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_PILL[request.status]}`}>
              {NURSE_SHORTAGE_STATUS_LABELS[request.status]}
            </span>
          } />
          <Row label="مرسل منذ" value={relativeTime(request.createdAt)} />
        </div>
        {request.note && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-[11px] text-amber-800 font-semibold mb-0.5">ملاحظة الممرض</p>
              <p className="text-xs text-amber-800 leading-relaxed">{request.note}</p>
            </div>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <header className="px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-bold text-[#164E63]">العناصر المطلوبة ({items.length})</h3>
        </header>
        <ul>
          {items.length === 0 && <li className="px-5 py-6 text-center text-xs text-gray-400">لا توجد عناصر</li>}
          {items.map((it) => (
            <li key={it.id} className="px-5 py-3 border-b border-gray-50 last:border-0 flex items-center justify-between text-sm">
              <span className="text-[#164E63]">{it.toolNameAr ?? it.toolId}</span>
              <span className="font-semibold text-[#164E63]">× {it.requestedQuantity}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[#164E63]">ملاحظة الإدارة (داخلية)</h3>
          {dirty && (
            <button onClick={saveNote} className="text-xs px-2 py-1 rounded-md bg-[#0891B2] text-white cursor-pointer flex items-center gap-1">
              <Save size={11} aria-hidden="true" /> حفظ الملاحظة
            </button>
          )}
        </div>
        <textarea
          value={adminNote} onChange={(e) => setAdminNote(e.target.value)} rows={3}
          placeholder="ملاحظة لا يراها الممرض"
          className="w-full p-3 rounded-xl border border-gray-200 text-sm resize-none focus:border-[#0891B2] outline-none"
        />
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-2">
        <h3 className="text-sm font-bold text-[#164E63] mb-2">تحديث الحالة</h3>
        <div className="flex flex-wrap gap-2">
          {transitions.map((t) => {
            const allowed = t.allowed.includes(request.status);
            return (
              <button
                key={t.to}
                onClick={() => transition(t.to, t.label)}
                disabled={!allowed || request.status === t.to}
                className={`text-xs px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  t.to === "cancelled" ? "bg-red-50 text-red-600" : "bg-[#ECFEFF] text-[#0891B2]"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-400">يتم تسجيل كل تغيير في سجل النشاط.</p>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-gray-400">{label}</p>
      <div className="text-[#164E63] font-medium mt-0.5">{value}</div>
    </div>
  );
}
