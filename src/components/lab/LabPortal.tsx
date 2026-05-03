"use client";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Search, Building2, LogOut, ChevronRight, FileText, Upload,
  AlertTriangle, CheckCircle2, ClipboardList, DollarSign, Lock, Download,
} from "lucide-react";
import type { Lab, LabUser, Order, LabSettlement } from "@/lib/types";
import { LAB_USER_ROLE_LABELS } from "@/lib/types";
import {
  MOCK_LABS, LAB_ISSUE_REASONS, computeOrderLabAmount,
} from "@/lib/mock-data";
import {
  useOrders, uploadResultFile, archiveResultFile, openLabIssue, setOrderStatus,
  confirmResultsReady,
} from "@/lib/store";
import { useSession, logout, labUserFromSession } from "@/lib/auth";
import { LoginForm } from "@/components/auth/LoginForm";
import { DEMO_LAB_CREDENTIALS } from "@/lib/demo-credentials";

const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_CREDS === "true";
import { useSettlementsForLab, useSettlementItems, hydrateSettlementsForLab } from "@/lib/settlements";
import { useEditableLab, updateLabSelf } from "@/lib/lab-overrides";
import { formatDate, formatPrice, getShiftLabel } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { OrderControlCenter } from "@/components/admin/OrderControlCenter";
import { useToast } from "@/components/ui/Toast";

// Lab portal lifecycle statuses — anything we can act on, plus completed for history.
const LAB_STATUSES = [
  "sample_collected", "sent_to_lab", "lab_processing",
  "result_ready", "completed", "lab_issue",
] as const;

export function LabPortal() {
  const auth = useSession();
  // Phase 8: build the LabUser shape from the enriched session. Older
  // builds resolved this through MOCK_LAB_USERS; the session now carries
  // labUserId / labId / labRole directly from the server.
  const labUser: LabUser | null = useMemo(() => {
    if (!auth || auth.role !== "lab" || !auth.labUserId || !auth.labId) return null;
    const fallback = labUserFromSession(auth);
    return {
      id: auth.labUserId,
      labId: auth.labId,
      username: auth.username,
      password: "",
      fullName: auth.name || fallback?.fullName || auth.username,
      role: (auth.labRole ?? fallback?.role ?? "lab_admin"),
      isActive: true,
    };
  }, [auth]);
  const lab = useMemo(
    () => (labUser ? MOCK_LABS.find((l) => l.id === labUser.labId) ?? null : null),
    [labUser],
  );

  // Apply per-lab branding via CSS variables. Cleared on logout.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (lab?.branding) {
      root.style.setProperty("--lab-primary", lab.branding.primaryColor);
      root.style.setProperty("--lab-secondary", lab.branding.secondaryColor);
      root.style.setProperty("--lab-accent", lab.branding.accentColor);
    } else {
      root.style.removeProperty("--lab-primary");
      root.style.removeProperty("--lab-secondary");
      root.style.removeProperty("--lab-accent");
    }
  }, [lab]);

  if (!auth || auth.role !== "lab" || !labUser || !lab) {
    return (
      <LoginForm
        brandTitle="بوابة المخبر"
        brandSubtitle="سجّل دخولك ببيانات الحساب الذي زوّدتك به الإدارة."
        allowedRoles={["lab"]}
        onSuccess={() => { /* useSession() re-renders LabPortal */ }}
        demoCredentials={SHOW_DEMO ? DEMO_LAB_CREDENTIALS.map((c) => ({
          label: c.label, username: c.email, password: c.password,
        })) : undefined}
      />
    );
  }

  return (
    <LabPortalShell
      lab={lab}
      labUser={labUser}
      onLogout={logout}
    />
  );
}

// ─── Main shell with section nav ─────────────────────────────────────────────
type LabSection = "orders" | "results" | "issues" | "accounting" | "lab_settings";

function LabPortalShell({ lab, labUser, onLogout }: { lab: Lab; labUser: LabUser; onLogout: () => void }) {
  const orders = useOrders();
  const labOrders = useMemo(
    () => orders.filter((o) => o.labId === lab.id && (LAB_STATUSES as readonly string[]).includes(o.status)),
    [orders, lab.id],
  );

  const canAccount = labUser.role === "lab_admin" || labUser.role === "lab_accounting";
  const initialSection: LabSection = labUser.role === "lab_accounting" ? "accounting" : "orders";
  const [section, setSection] = useState<LabSection>(initialSection);

  const brand = lab.branding ?? { primaryColor: "#0891B2", secondaryColor: "#0E7490", accentColor: "#ECFEFF" };
  const portalName = lab.branding?.portalDisplayName ?? `بوابة ${lab.nameAr}`;

  const isLabAdmin = labUser.role === "lab_admin";
  const sections: { id: LabSection; labelAr: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
    { id: "orders",     labelAr: "الطلبات",       Icon: ClipboardList },
    { id: "results",    labelAr: "رفع النتائج",   Icon: Upload },
    { id: "issues",     labelAr: "مشاكل المخبر",  Icon: AlertTriangle },
    ...(canAccount ? [{ id: "accounting" as LabSection, labelAr: "المحاسبة", Icon: DollarSign }] : []),
    ...(isLabAdmin ? [{ id: "lab_settings" as LabSection, labelAr: "إعدادات المخبر", Icon: Building2 }] : []),
  ];

  return (
    <div className="min-h-screen bg-app flex">
      {/* Sidebar */}
      <aside className="w-full md:w-72 lg:w-80 bg-white border-s border-gray-100 flex flex-col h-screen sticky top-0">
        <div className="px-4 py-4 border-b border-gray-100 flex items-center gap-3" style={{ background: brand.accentColor }}>
          {lab.branding?.logo ?? lab.logo ? (
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-white relative flex-shrink-0">
              <Image src={(lab.branding?.logo ?? lab.logo)!} alt="" fill sizes="40px" className="object-cover" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: brand.primaryColor }}>
              <Building2 size={18} className="text-white" aria-hidden="true" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: brand.primaryColor }}>{portalName}</p>
            <p className="text-[11px] truncate" style={{ color: brand.secondaryColor }}>
              {labUser.fullName} · {LAB_USER_ROLE_LABELS[labUser.role]}
            </p>
          </div>
          <button onClick={onLogout} aria-label="تسجيل الخروج" className="w-8 h-8 rounded-lg hover:bg-white/60 flex items-center justify-center cursor-pointer">
            <LogOut size={15} className="text-gray-500" aria-hidden="true" />
          </button>
        </div>

        <nav className="p-3 space-y-1" aria-label="أقسام البوابة">
          {sections.map((s) => {
            const active = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                aria-current={active ? "page" : undefined}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-colors"
                style={{
                  background: active ? brand.accentColor : "transparent",
                  color: active ? brand.primaryColor : "#6B7280",
                }}
              >
                <s.Icon size={16} className={active ? "" : "text-gray-400"} />
                {s.labelAr}
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-gray-100 mt-auto text-[11px] text-gray-400">
          {lab.nameAr} · {lab.city ?? "—"}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {section === "orders"     && <OrdersSection lab={lab} labUser={labUser} labOrders={labOrders} brand={brand} />}
        {section === "results"    && <OrdersSection lab={lab} labUser={labUser} labOrders={labOrders.filter((o) => o.status !== "lab_issue")} brand={brand} resultsFocus />}
        {section === "issues"     && <IssuesSection lab={lab} labOrders={labOrders.filter((o) => o.status === "lab_issue" || (o.issues?.length ?? 0) > 0)} brand={brand} />}
        {section === "accounting" && (canAccount ? <AccountingSection lab={lab} brand={brand} /> : <NoAccess />)}
        {section === "lab_settings" && (isLabAdmin ? <LabSettingsSection lab={lab} /> : <NoAccess />)}
      </main>
    </div>
  );
}

function NoAccess() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-gray-400 p-8 text-center">
      <div>
        <Lock size={32} className="text-gray-300 mx-auto mb-2" aria-hidden="true" />
        <p>هذه الصفحة متاحة لمحاسب المخبر فقط.</p>
      </div>
    </div>
  );
}

// ─── Section: Orders / Results ───────────────────────────────────────────────
function OrdersSection({ lab, labUser, labOrders, brand, resultsFocus }: {
  lab: Lab; labUser: LabUser; labOrders: Order[];
  brand: { primaryColor: string; secondaryColor: string; accentColor: string };
  resultsFocus?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(labOrders[0]?.id ?? null);
  const [openControlCenter, setOpenControlCenter] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replacingFileId, setReplacingFileId] = useState<string | null>(null);
  const toast = useToast();

  const filtered = useMemo(() => labOrders.filter((o) => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (search && !o.id.includes(search) && !o.patient.name.includes(search)) return false;
    return true;
  }), [labOrders, search, statusFilter]);

  const selected = filtered.find((o) => o.id === selectedId) ?? filtered[0] ?? null;
  const selectedFiles = (selected?.resultFiles ?? []).filter((f) => f.isActive);
  const showSellPrices = !!lab.revealSellPriceToLab;

  return (
    <div className="flex h-screen">
      {/* List pane */}
      <div className="w-full md:w-96 border-s border-gray-100 bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-gray-100 space-y-2">
          <h2 className="text-base font-bold text-[#164E63]">{resultsFocus ? "رفع النتائج" : "الطلبات"}</h2>
          <div className="relative">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم الطلب أو المريض" aria-label="بحث"
              className="w-full h-10 ps-9 pe-3 rounded-xl border border-gray-200 text-sm outline-none"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {[
              { v: "all",              label: "الكل" },
              { v: "sent_to_lab",      label: "وصلت" },
              { v: "lab_processing",   label: "قيد المعالجة" },
              { v: "result_ready",     label: "جاهزة" },
            ].map((s) => (
              <button
                key={s.v}
                onClick={() => setStatusFilter(s.v)}
                aria-pressed={statusFilter === s.v}
                className="px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap cursor-pointer"
                style={{
                  background: statusFilter === s.v ? brand.primaryColor : "#F3F4F6",
                  color: statusFilter === s.v ? "#fff" : "#4B5563",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              {labOrders.length === 0 ? "لم يتم إسناد أي طلب لهذا المخبر بعد" : "لا توجد طلبات تطابق التصفية"}
            </div>
          ) : (
            <ul role="list">
              {filtered.map((o) => {
                const isSel = o.id === selected?.id;
                const fileCount = (o.resultFiles ?? []).filter((f) => f.isActive).length;
                return (
                  <li key={o.id}>
                    <button
                      onClick={() => setSelectedId(o.id)}
                      className="w-full text-start px-4 py-3 border-b border-gray-50 flex items-center gap-3 cursor-pointer transition-colors"
                      style={isSel ? { background: brand.accentColor } : undefined}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[#164E63] truncate">{o.patient.name}</p>
                          {fileCount > 0 && (
                            <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold">
                              {fileCount} PDF
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5 lat" dir="ltr">{o.id}</p>
                      </div>
                      <StatusBadge status={o.status} />
                      <ChevronRight size={14} className="text-gray-300 flex-shrink-0 rotate-180" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selected ? (
          <div className="p-6 lg:p-8 max-w-4xl">
            <header className="flex items-start justify-between gap-4 mb-6 flex-wrap">
              <div>
                <p className="text-xs text-gray-500 mb-1 lat" dir="ltr">{selected.id}</p>
                <h1 className="text-xl lg:text-2xl font-bold text-[#164E63]">{selected.patient.name}</h1>
                <div className="flex items-center gap-2 mt-2">
                  <StatusBadge status={selected.status} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setIssueOpen(true)}>
                  <AlertTriangle size={14} aria-hidden="true" /> الإبلاغ عن مشكلة
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
                  <Upload size={14} aria-hidden="true" /> رفع ملفات PDF
                </Button>
                <Button
                  variant="primary" size="sm"
                  disabled={selectedFiles.length === 0 || selected.status === "completed"}
                  onClick={() => {
                    const ok = confirmResultsReady(selected.id, { actor: "lab", actorName: labUser.fullName });
                    if (ok) toast.success("تم إرسال النتائج — اكتمل الطلب");
                    else toast.error("ارفع ملف نتيجة واحداً على الأقل قبل التأكيد");
                  }}
                >
                  <CheckCircle2 size={14} aria-hidden="true" /> تأكيد إرسال النتائج
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setOpenControlCenter(true)}>
                  مركز تحكم الطلب
                </Button>
              </div>
            </header>

            {/* Quick info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              <InfoCard label="الموعد" value={`${formatDate(selected.visitDate)} · ${getShiftLabel(selected.shift)}`} />
              <InfoCard label="نوع الطلب" value={selected.type === "package" ? "باقة" : selected.type === "prescription" ? "وصفة" : "تحاليل مختارة"} />
              {showSellPrices ? (
                <InfoCard label="إجمالي الطلب" value={formatPrice(selected.total)} />
              ) : (
                <InfoCard label="عدد التحاليل" value={String(selected.items.length)} />
              )}
            </div>

            {/* Tests — sell price only when permitted */}
            <section className="bg-white rounded-2xl border border-gray-100 p-5 mb-5">
              <header className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-[#164E63] flex items-center gap-2">
                  <ClipboardList size={16} style={{ color: brand.primaryColor }} aria-hidden="true" />
                  التحاليل المطلوبة ({selected.items.length})
                </h2>
              </header>
              <ul role="list" className="divide-y divide-gray-50">
                {selected.items.map((it) => (
                  <li key={it.id} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-[#164E63]">{it.nameAr}</p>
                      <p className="text-xs text-gray-400 lat" dir="ltr">{it.nameEn}</p>
                    </div>
                    {showSellPrices && (
                      <span className="text-xs text-gray-500">{formatPrice(it.priceSnapshot)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {/* Internal admin notes */}
            {(selected.internalNotes || (selected.notes?.length ?? 0) > 0) && (
              <section className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-5">
                <p className="text-xs text-amber-800 font-semibold mb-1">ملاحظات الإدارة</p>
                {selected.internalNotes && (
                  <p className="text-sm text-amber-800 leading-relaxed">{selected.internalNotes}</p>
                )}
                {selected.notes?.map((n) => (
                  <p key={n.id} className="text-xs text-amber-800 leading-relaxed mt-1">• {n.text}</p>
                ))}
              </section>
            )}

            {/* Result files */}
            <section className="bg-white rounded-2xl border border-gray-100 p-5">
              <header className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-[#164E63] flex items-center gap-2">
                  <FileText size={16} style={{ color: brand.primaryColor }} aria-hidden="true" />
                  ملفات النتيجة ({selectedFiles.length})
                </h2>
                <p className="text-[11px] text-gray-500">يمكن رفع ملف PDF واحد أو أكثر للطلب كاملاً</p>
              </header>

              {selectedFiles.length === 0 && (selected.resultFiles ?? []).filter((f) => !f.isActive).length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
                  <Upload size={28} className="text-gray-300 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-sm text-gray-500 mb-3">لم يُرفع أي ملف بعد</p>
                  <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
                    <Upload size={14} aria-hidden="true" /> رفع أول PDF
                  </Button>
                </div>
              ) : (
                <ul role="list" className="space-y-2">
                  {selectedFiles.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                      <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                        <FileText size={17} className="text-red-500" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#164E63] truncate">{f.fileName}</p>
                        <p className="text-[11px] text-gray-500">رفعها {f.uploadedBy} · {formatDate(f.uploadedAt)}</p>
                        {f.note && <p className="text-[11px] text-gray-400 mt-0.5">{f.note}</p>}
                      </div>
                      <a href={f.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs px-2 cursor-pointer" style={{ color: brand.primaryColor }}>
                        فتح
                      </a>
                      <button
                        onClick={() => setReplacingFileId(f.id)}
                        className="text-[11px] px-2 py-1 rounded-md bg-cyan-50 text-cyan-700 cursor-pointer"
                      >
                        استبدال
                      </button>
                      <button
                        onClick={() => {
                          archiveResultFile(selected.id, f.id, { actor: "lab", actorName: labUser.fullName });
                          toast.success("تم أرشفة الملف");
                        }}
                        aria-label={`أرشفة ${f.fileName}`}
                        className="w-8 h-8 rounded-lg hover:bg-amber-50 flex items-center justify-center cursor-pointer"
                        title="أرشفة (لا يُحذف نهائياً، يبقى ظاهراً للإدارة)"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                  {(selected.resultFiles ?? []).filter((f) => !f.isActive).length > 0 && (
                    <details className="mt-3 group">
                      <summary className="text-[11px] text-gray-500 cursor-pointer">
                        ملفات مؤرشفة (تظهر للإدارة فقط)
                      </summary>
                      <ul role="list" className="mt-2 space-y-2">
                        {(selected.resultFiles ?? []).filter((f) => !f.isActive).map((f) => (
                          <li key={f.id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3 opacity-50">
                            <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                              <FileText size={17} className="text-gray-400" aria-hidden="true" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-500 truncate line-through">{f.fileName}</p>
                              <p className="text-[11px] text-gray-400">أُرشفت {f.archivedAt ? formatDate(f.archivedAt) : "—"}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </ul>
              )}
            </section>

            {/* File activity log */}
            {(selected.fileEvents?.length ?? 0) > 0 && (
              <section className="bg-white rounded-2xl border border-gray-100 p-5 mt-5">
                <header className="mb-3">
                  <h2 className="text-sm font-bold text-[#164E63] flex items-center gap-2">
                    <ClipboardList size={16} style={{ color: brand.primaryColor }} aria-hidden="true" />
                    سجل ملفات الطلب
                  </h2>
                </header>
                <ol className="space-y-2">
                  {[...(selected.fileEvents ?? [])].reverse().map((ev) => (
                    <li key={ev.id} className="flex items-start gap-3 text-xs">
                      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                        ev.type === "uploaded" ? "bg-emerald-500" :
                        ev.type === "replaced" ? "bg-cyan-500" :
                        ev.type === "restored" ? "bg-purple-500" :
                                                 "bg-amber-500"
                      }`} aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[#164E63]">
                          <span className="font-semibold">
                            {ev.type === "uploaded" ? "رفع ملف" :
                             ev.type === "replaced" ? "استبدال ملف" :
                             ev.type === "restored" ? "استعادة ملف" :
                                                       "أرشفة ملف"}
                          </span>
                          {" — "}
                          <span className="text-gray-500">{ev.fileName}</span>
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{ev.actorName} · {formatDate(ev.createdAt)}</p>
                        {ev.note && <p className="text-[11px] text-gray-400 mt-0.5">{ev.note}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {issueOpen && (
              <IssueModal
                onClose={() => setIssueOpen(false)}
                onSubmit={(type, description) => {
                  openLabIssue({
                    orderId: selected.id, labId: lab.id, type, description,
                    createdBy: labUser.fullName, createdByRole: "lab",
                  });
                  toast.success("تم تسجيل المشكلة");
                  setIssueOpen(false);
                }}
              />
            )}

            {uploadOpen && (
              <MultiUploadModal
                title="رفع ملفات نتيجة"
                onClose={() => setUploadOpen(false)}
                onSubmit={async (files, note) => {
                  let firstError: string | null = null;
                  for (const f of files) {
                    const res = await uploadResultFile(selected.id, {
                      labId: lab.id,
                      fileUrl: f.dataUrl ?? `/results/${selected.id}/${f.name}`,
                      blob: f.blob,
                      fileName: f.name,
                      uploadedBy: labUser.fullName,
                      note,
                    });
                    if (!res.ok && !firstError) firstError = res.error ?? "حدث خطأ";
                  }
                  if (selected.status === "sent_to_lab") {
                    setOrderStatus(selected.id, "lab_processing", { actor: "lab", actorName: labUser.fullName });
                  }
                  if (firstError) toast.error(firstError);
                  else toast.success(files.length > 1 ? `تم رفع ${files.length} ملفات بنجاح` : "تم رفع الملف بنجاح");
                  setUploadOpen(false);
                }}
              />
            )}

            {replacingFileId && (
              <MultiUploadModal
                title="استبدال ملف"
                singleOnly
                onClose={() => setReplacingFileId(null)}
                onSubmit={async (files, note) => {
                  const f = files[0];
                  if (!f) return;
                  const res = await uploadResultFile(selected.id, {
                    labId: lab.id,
                    fileUrl: f.dataUrl ?? `/results/${selected.id}/${f.name}`,
                    blob: f.blob,
                    fileName: f.name,
                    uploadedBy: labUser.fullName,
                    note,
                    replacesFileId: replacingFileId,
                  });
                  if (res.ok) toast.success("تم استبدال الملف");
                  else toast.error(res.error ?? "تعذر استبدال الملف");
                  setReplacingFileId(null);
                }}
              />
            )}

            {openControlCenter && (
              <OrderControlCenter
                order={selected}
                role={{ role: "lab_user", actor: "lab", actorName: labUser.fullName }}
                nurses={[]}
                labs={MOCK_LABS}
                onClose={() => setOpenControlCenter(false)}
              />
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 p-8 text-center">
            {labOrders.length === 0 ? "لم يتم إسناد أي طلب لهذا المخبر بعد" : "اختر طلباً من القائمة"}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section: Issues ─────────────────────────────────────────────────────────
function IssuesSection({ lab, labOrders, brand }: {
  lab: Lab; labOrders: Order[];
  brand: { primaryColor: string; secondaryColor: string; accentColor: string };
}) {
  void lab;
  void brand;
  const items = labOrders.flatMap((o) => (o.issues ?? []).map((i) => ({ ...i, _patient: o.patient.name, _orderStatus: o.status })));
  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <h2 className="text-base font-bold text-[#164E63] mb-4">مشاكل المخبر</h2>
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          لا توجد مشاكل مسجّلة
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <p className="text-sm font-bold text-[#164E63]">
                  {LAB_ISSUE_REASONS.find((r) => r.value === i.type)?.labelAr ?? i.type}
                  <span className="text-gray-400 font-normal lat ms-1" dir="ltr">· {i.orderId}</span>
                </p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${i.status === "resolved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {i.status === "resolved" ? "محلولة" : "مفتوحة"}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{i.description}</p>
              <p className="text-[11px] text-gray-400 mt-2">المريض: {i._patient}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Section: Accounting ─────────────────────────────────────────────────────
function AccountingSection({ lab, brand }: {
  lab: Lab;
  brand: { primaryColor: string; secondaryColor: string; accentColor: string };
}) {
  const orders = useOrders();
  const settlements = useSettlementsForLab(lab.id);
  const showSellPrices = !!lab.revealSellPriceToLab;
  // Stage D: pull this lab's persisted settlements on mount.
  useEffect(() => { void hydrateSettlementsForLab(lab.id); }, [lab.id]);

  // Completed/result-ready orders for this lab — what counts toward future settlements.
  const eligibleOrders = useMemo(
    () => orders.filter((o) => o.labId === lab.id && (o.status === "completed" || o.status === "result_ready")),
    [orders, lab.id],
  );

  const totalEarned = settlements.reduce((s, x) => s + x.totalLabAmount, 0);
  const totalPaid   = settlements.reduce((s, x) => s + x.totalPaid, 0);
  const outstanding = totalEarned - totalPaid;

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <header className="mb-6">
        <h2 className="text-base font-bold text-[#164E63]">المحاسبة</h2>
        <p className="text-xs text-gray-500 mt-1">
          الأرقام تعكس ما يحقّ للمخبر من سعر التحاليل المتفق عليه. لا تظهر هنا أسعار البيع للعميل.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <StatTile label="إجمالي مستحق" value={formatPrice(totalEarned)} color="bg-cyan-50 text-cyan-700" />
        <StatTile label="مدفوع" value={formatPrice(totalPaid)} color="bg-emerald-50 text-emerald-700" />
        <StatTile label="متبقي" value={formatPrice(outstanding)} color="bg-amber-50 text-amber-700" />
      </div>

      <SettlementsTable settlements={settlements} brand={brand} />

      <section className="mt-6 bg-white rounded-2xl border border-gray-100">
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-[#164E63]">الطلبات المكتملة في الفترة الحالية</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">تُضاف للتسوية الشهرية القادمة. الإدارة تولّد التسوية.</p>
          </div>
          <button
            onClick={() => exportOrdersCsv(lab.id, eligibleOrders, lab.nameAr)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 cursor-pointer flex items-center gap-1.5 active:bg-gray-50"
          >
            <Download size={13} aria-hidden="true" />
            تصدير CSV
          </button>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="text-start py-2.5 px-4 font-semibold">رقم</th>
                <th className="text-start py-2.5 px-4 font-semibold">التاريخ</th>
                <th className="text-start py-2.5 px-4 font-semibold">العناصر</th>
                {showSellPrices && <th className="text-start py-2.5 px-4 font-semibold">سعر البيع</th>}
                <th className="text-start py-2.5 px-4 font-semibold">مستحق المخبر</th>
              </tr>
            </thead>
            <tbody>
              {eligibleOrders.length === 0 && (
                <tr><td colSpan={showSellPrices ? 5 : 4} className="text-center text-gray-400 py-6 text-xs">لا توجد طلبات مكتملة بعد</td></tr>
              )}
              {eligibleOrders.map((o) => {
                const labAmount = computeOrderLabAmount(lab.id, o.items);
                return (
                  <tr key={o.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 px-4 text-xs lat" dir="ltr">{o.id}</td>
                    <td className="py-2.5 px-4 text-xs text-gray-500">{formatDate(o.visitDate)}</td>
                    <td className="py-2.5 px-4 text-xs">{o.packageSnapshot?.nameAr ?? `${o.items.length} تحليل`}</td>
                    {showSellPrices && <td className="py-2.5 px-4 text-xs text-gray-500">{formatPrice(o.total)}</td>}
                    <td className="py-2.5 px-4 text-xs font-bold text-[#164E63]">{formatPrice(labAmount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SettlementsTable({ settlements, brand }: { settlements: LabSettlement[]; brand: { primaryColor: string } }) {
  const [openSettlement, setOpenSettlement] = useState<LabSettlement | null>(null);
  return (
    <section className="bg-white rounded-2xl border border-gray-100">
      <header className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-bold text-[#164E63]">التسويات</h3>
      </header>
      {settlements.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">لا توجد تسويات بعد. الإدارة ستولّد التسوية الشهرية.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="text-start py-2.5 px-4 font-semibold">الفترة</th>
                <th className="text-start py-2.5 px-4 font-semibold">عدد الطلبات</th>
                <th className="text-start py-2.5 px-4 font-semibold">المستحق</th>
                <th className="text-start py-2.5 px-4 font-semibold">المدفوع</th>
                <th className="text-start py-2.5 px-4 font-semibold">الحالة</th>
                <th className="text-end py-2.5 px-4 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2.5 px-4 text-xs lat" dir="ltr">{s.periodStart} → {s.periodEnd}</td>
                  <td className="py-2.5 px-4 text-xs">{s.totalOrders}</td>
                  <td className="py-2.5 px-4 text-xs">{formatPrice(s.totalLabAmount)}</td>
                  <td className="py-2.5 px-4 text-xs">{formatPrice(s.totalPaid)}</td>
                  <td className="py-2.5 px-4">
                    <SettlementStatusPill status={s.status} />
                  </td>
                  <td className="py-2.5 px-4 text-end">
                    <button
                      onClick={() => setOpenSettlement(s)}
                      className="text-xs px-2 py-1 rounded-md cursor-pointer"
                      style={{ background: brand.primaryColor + "15", color: brand.primaryColor }}
                    >
                      تفاصيل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openSettlement && (
        <SettlementDrawer settlement={openSettlement} onClose={() => setOpenSettlement(null)} />
      )}
    </section>
  );
}

function SettlementDrawer({ settlement, onClose }: { settlement: LabSettlement; onClose: () => void }) {
  const items = useSettlementItems(settlement.id);
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <header className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#164E63]">
              تسوية {settlement.periodStart} → {settlement.periodEnd}
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{settlement.totalOrders} طلب · {formatPrice(settlement.totalLabAmount)}</p>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer">×</button>
        </header>
        <div className="overflow-y-auto p-5">
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
                <span className="text-xs lat" dir="ltr">{it.orderId}</span>
                <span className="text-xs font-semibold text-[#164E63]">{formatPrice(it.labAmount)}</span>
              </li>
            ))}
            {items.length === 0 && <li className="text-xs text-gray-400 text-center py-4">لا توجد طلبات</li>}
          </ul>
          {settlement.notes && (
            <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-100">
              <p className="text-[11px] text-amber-800 font-semibold mb-1">ملاحظة</p>
              <p className="text-xs text-amber-800 leading-relaxed">{settlement.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettlementStatusPill({ status }: { status: LabSettlement["status"] }) {
  const map = {
    pending:        "bg-amber-50 text-amber-700",
    partially_paid: "bg-cyan-50 text-cyan-700",
    paid:           "bg-emerald-50 text-emerald-700",
  };
  const label = status === "pending" ? "بانتظار الدفع" : status === "partially_paid" ? "مدفوعة جزئياً" : "مدفوعة";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${map[status]}`}>{label}</span>;
}

// ─── CSV export helper ──────────────────────────────────────────────────────
function exportOrdersCsv(labId: string, orders: Order[], labNameAr: string) {
  const rows = [
    ["order_id", "visit_date", "items", "lab_amount"],
    ...orders.map((o) => [
      o.id,
      o.visitDate,
      o.packageSnapshot?.nameEn ?? `${o.items.length} tests`,
      String(computeOrderLabAmount(labId, o.items)),
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${labNameAr.replace(/\s+/g, "_")}-orders.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Local helpers ───────────────────────────────────────────────────────────
function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3">
      <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm font-medium text-[#164E63] leading-snug">{value}</p>
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-[11px] text-gray-400 font-medium">{label}</p>
      <p className={`text-lg font-bold mt-1 inline-block px-2 rounded-md ${color}`}>{value}</p>
    </div>
  );
}

function IssueModal({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (type: import("@/lib/types").LabIssueType, description: string) => void;
}) {
  const [type, setType] = useState<import("@/lib/types").LabIssueType>("invalid_sample");
  const [desc, setDesc] = useState("");
  return (
    <Modal title="الإبلاغ عن مشكلة في العينة" onClose={onClose}>
      <div className="space-y-2">
        {LAB_ISSUE_REASONS.map((r) => (
          <button
            key={r.value}
            onClick={() => setType(r.value as import("@/lib/types").LabIssueType)}
            aria-pressed={type === r.value}
            className={`w-full text-start p-3 rounded-xl border-2 cursor-pointer transition-colors ${
              type === r.value ? "border-[#0891B2] bg-[#ECFEFF]" : "border-gray-200 hover:bg-gray-50"
            }`}
          >
            <span className="text-sm text-[#164E63]">{r.labelAr}</span>
          </button>
        ))}
        <textarea
          value={desc} onChange={(e) => setDesc(e.target.value)}
          rows={3} placeholder="وصف المشكلة"
          className="w-full mt-2 p-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none resize-none"
        />
      </div>
      <div className="flex gap-2 mt-4">
        <Button variant="outline" className="flex-1" onClick={onClose}>إلغاء</Button>
        <Button variant="danger" className="flex-1" disabled={!desc.trim()} onClick={() => onSubmit(type, desc.trim())}>
          فتح المشكلة
        </Button>
      </div>
    </Modal>
  );
}

interface UploadFile { name: string; dataUrl?: string; blob?: File }

function MultiUploadModal({ title, singleOnly, onClose, onSubmit }: {
  title: string;
  singleOnly?: boolean;
  onClose: () => void;
  onSubmit: (files: UploadFile[], note?: string) => void;
}) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [manualName, setManualName] = useState("");
  const [note, setNote] = useState("");

  const handlePick = (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list).slice(0, singleOnly ? 1 : list.length);
    Promise.all(
      arr.map((f) => new Promise<UploadFile>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve({
          name: f.name,
          dataUrl: typeof r.result === "string" ? r.result : undefined,
          blob: f,
        });
        r.readAsDataURL(f);
      })),
    ).then((picked) => setFiles(singleOnly ? picked.slice(0, 1) : [...files, ...picked]));
  };

  const removeAt = (i: number) => setFiles(files.filter((_, idx) => idx !== i));

  const total = files.length + (manualName.trim() ? 1 : 0);
  const canSubmit = total > 0 && (!singleOnly || total === 1);

  const submit = () => {
    const out = [...files];
    if (manualName.trim() && (!singleOnly || out.length === 0)) out.push({ name: manualName.trim() });
    onSubmit(out, note.trim() || undefined);
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-gray-500">
          {singleOnly ? "اختر ملف PDF" : "اختر ملف أو أكثر (PDF)"}
          <input
            type="file" accept="application/pdf"
            multiple={!singleOnly}
            onChange={(e) => handlePick(e.target.files)}
            className="block w-full mt-1 text-sm file:me-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#ECFEFF] file:text-[#0891B2] file:font-semibold file:cursor-pointer cursor-pointer"
          />
        </label>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-2 text-xs">
                <FileText size={14} className="text-red-500 flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate text-[#164E63]">{f.name}</span>
                <button onClick={() => removeAt(i)} aria-label="إزالة" className="w-6 h-6 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer">×</button>
              </li>
            ))}
          </ul>
        )}

        {(!singleOnly || files.length === 0) && (
          <label className="block text-xs font-medium text-gray-500">
            أو اكتب اسم ملف يدوياً
            <input
              type="text" value={manualName} onChange={(e) => setManualName(e.target.value)}
              placeholder="ord-1234-results.pdf"
              className="w-full mt-1 h-10 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none"
              style={{ direction: "ltr", textAlign: "right" }}
            />
          </label>
        )}

        <label className="block text-xs font-medium text-gray-500">
          ملاحظة (اختيارية)
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="مثلاً: نتائج كاملة + تقرير منفصل" rows={2}
            className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none resize-none"
          />
        </label>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" className="flex-1" disabled={!canSubmit} onClick={submit}>
            {singleOnly ? "استبدال" : files.length > 1 ? `رفع ${files.length} ملفات` : "رفع"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl overflow-hidden">
        <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-[#164E63]">{title}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer">×</button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Section: Lab Settings (lab_admin only, non-critical fields) ───────────
function LabSettingsSection({ lab }: { lab: Lab }) {
  const live = useEditableLab(lab.id) ?? lab;
  const toast = useToast();
  const [draft, setDraft] = useState({
    nameAr: live.nameAr,
    nameEn: live.nameEn,
    logo: live.logo ?? "",
    phoneMain: live.phoneMain,
    phoneSecondary: live.phoneSecondary ?? "",
    email: live.email ?? "",
    whatsapp: live.whatsapp ?? "",
    workingHours: live.workingHours ?? "",
    acceptedSampleTypes: (live.acceptedSampleTypes ?? []).join(", "),
    supportedCities: (live.supportedCities ?? []).join("، "),
    portalDisplayName: live.branding?.portalDisplayName ?? "",
    primaryColor: live.branding?.primaryColor ?? "#0891B2",
    secondaryColor: live.branding?.secondaryColor ?? "#0E7490",
    accentColor: live.branding?.accentColor ?? "#ECFEFF",
  });

  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    if (!draft.nameAr.trim() || !draft.phoneMain.trim()) {
      toast.error("الاسم والهاتف الرئيسي مطلوبان");
      return;
    }
    updateLabSelf(lab.id, {
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim(),
      name:   draft.nameAr.trim(),       // legacy alias
      phone:  draft.phoneMain.trim(),    // legacy alias
      logo:   draft.logo.trim() || undefined,
      phoneMain: draft.phoneMain.trim(),
      phoneSecondary: draft.phoneSecondary.trim() || undefined,
      email: draft.email.trim() || undefined,
      whatsapp: draft.whatsapp.trim() || undefined,
      workingHours: draft.workingHours.trim() || undefined,
      acceptedSampleTypes: draft.acceptedSampleTypes.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
      supportedCities: draft.supportedCities.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
      branding: {
        primaryColor: draft.primaryColor,
        secondaryColor: draft.secondaryColor,
        accentColor: draft.accentColor,
        portalDisplayName: draft.portalDisplayName.trim() || undefined,
        logo: draft.logo.trim() || undefined,
      },
    });
    toast.success("تم الحفظ بنجاح");
  };

  return (
    <div className="p-6 lg:p-8 max-w-3xl space-y-4">
      <header>
        <h2 className="text-base font-bold text-[#164E63]">إعدادات المخبر</h2>
        <p className="text-xs text-gray-500 mt-1">يمكن لمدير المخبر تعديل البيانات التشغيلية والهوية البصرية. البيانات الرسمية (السجل، الترخيص، الرقم الضريبي، العنوان) تُدار من قِبل الإدارة العامة فقط.</p>
      </header>

      <Card title="بيانات أساسية">
        <Field label="الاسم بالعربية"><input value={draft.nameAr} onChange={(e) => set("nameAr", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
        <Field label="الاسم بالإنجليزية"><input value={draft.nameEn} onChange={(e) => set("nameEn", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
        <Field label="رابط الشعار"><input value={draft.logo} onChange={(e) => set("logo", e.target.value)} placeholder="https://…" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
      </Card>

      <Card title="التواصل">
        <Field label="الهاتف الرئيسي"><input value={draft.phoneMain} onChange={(e) => set("phoneMain", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
        <Field label="هاتف ثانوي"><input value={draft.phoneSecondary} onChange={(e) => set("phoneSecondary", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
        <Field label="البريد الإلكتروني"><input value={draft.email} onChange={(e) => set("email", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
        <Field label="واتساب"><input value={draft.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
      </Card>

      <Card title="الإعدادات التشغيلية">
        <Field label="ساعات العمل"><input value={draft.workingHours} onChange={(e) => set("workingHours", e.target.value)} placeholder="8:00 – 20:00" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
        <Field label="أنواع العينات (مفصولة بفواصل)"><input value={draft.acceptedSampleTypes} onChange={(e) => set("acceptedSampleTypes", e.target.value)} placeholder="blood, urine" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
        <Field label="المدن المخدومة (مفصولة بفواصل)"><input value={draft.supportedCities} onChange={(e) => set("supportedCities", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
      </Card>

      <Card title="الهوية البصرية للبوابة">
        <Field label="اسم البوابة"><input value={draft.portalDisplayName} onChange={(e) => set("portalDisplayName", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
        <Field label="اللون الأساسي">
          <div className="flex items-center gap-2">
            <input type="color" value={draft.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
            <input value={draft.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} className="flex-1 h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
          </div>
        </Field>
        <Field label="اللون الثانوي">
          <div className="flex items-center gap-2">
            <input type="color" value={draft.secondaryColor} onChange={(e) => set("secondaryColor", e.target.value)} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
            <input value={draft.secondaryColor} onChange={(e) => set("secondaryColor", e.target.value)} className="flex-1 h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
          </div>
        </Field>
        <Field label="لون التمييز">
          <div className="flex items-center gap-2">
            <input type="color" value={draft.accentColor} onChange={(e) => set("accentColor", e.target.value)} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
            <input value={draft.accentColor} onChange={(e) => set("accentColor", e.target.value)} className="flex-1 h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
          </div>
        </Field>
      </Card>

      <Card title="بيانات رسمية (تحرير غير متاح)">
        <p className="text-[11px] text-gray-400 leading-relaxed mb-2">
          تُدار من قِبل الإدارة العامة فقط. تواصل مع الإدارة لأي تحديث.
        </p>
        <ReadRow label="الاسم الرسمي"   value={live.officialName ?? "—"} />
        <ReadRow label="رقم السجل"      value={live.registrationNumber ?? "—"} />
        <ReadRow label="رقم الترخيص"    value={live.licenseNumber ?? "—"} />
        <ReadRow label="الرقم الضريبي"  value={live.taxNumber ?? "—"} />
        <ReadRow label="العنوان الرسمي" value={live.addressFull ?? "—"} />
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={save}>حفظ التغييرات</Button>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-gray-50 bg-gray-50/40">
        <h3 className="text-xs font-bold text-[#164E63]">{title}</h3>
      </header>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-500 font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ReadRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-500 break-words text-end">{value}</span>
    </div>
  );
}
