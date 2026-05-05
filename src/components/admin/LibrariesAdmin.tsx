"use client";
import { useState } from "react";
import { ClipboardList, Wrench, Settings as SettingsIcon, Plus, Pencil, Trash2, Save, X } from "lucide-react";
import type { LibraryInstruction, LibraryTool, AdminRole } from "@/lib/types";
import {
  useLibraryInstructions, upsertLibraryInstruction, deleteLibraryInstruction, setLibraryInstructionActive,
} from "@/lib/instruction-library";
import {
  useLibraryTools, upsertLibraryTool, deleteLibraryTool, setLibraryToolActive,
  useChecklistDefaults, updateChecklistDefaults,
} from "@/lib/tool-library";
import { logActivity } from "@/lib/activity-log";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";

interface Props {
  adminId: string;
  adminName: string;
  adminRole: AdminRole;
}

type Tab = "instructions" | "tools" | "defaults";

export function LibrariesAdmin({ adminId, adminName, adminRole }: Props) {
  const [tab, setTab] = useState<Tab>("instructions");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-[#164E63]">المكتبات</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          مكتبة التعليمات وأدوات الممرض. تُستخدم في تعريف التحاليل وفي ضبط قائمة التحضير الصباحية للممرض.
        </p>
      </div>

      <div className="flex gap-1 px-1 border-b border-gray-100 overflow-x-auto no-scrollbar">
        {([
          { v: "instructions" as const, label: "تعليمات العميل", Icon: ClipboardList },
          { v: "tools"        as const, label: "أدوات الممرض",   Icon: Wrench },
          { v: "defaults"     as const, label: "إعدادات قائمة التحضير", Icon: SettingsIcon },
        ]).map((t) => {
          const active = tab === t.v;
          return (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                active ? "border-[#0891B2] text-[#0891B2]" : "border-transparent text-gray-500 hover:text-[#164E63]"
              }`}
            >
              <t.Icon size={13} className={active ? "text-[#0891B2]" : "text-gray-400"} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "instructions" && <InstructionsTab adminId={adminId} adminName={adminName} adminRole={adminRole} />}
      {tab === "tools"        && <ToolsTab        adminId={adminId} adminName={adminName} adminRole={adminRole} />}
      {tab === "defaults"     && <DefaultsTab     adminId={adminId} adminName={adminName} adminRole={adminRole} />}
    </div>
  );
}

// ─── Instructions tab ────────────────────────────────────────────────────────
function InstructionsTab({ adminId, adminName, adminRole }: Props) {
  const items = useLibraryInstructions();
  const toast = useToast();
  const [editing, setEditing] = useState<LibraryInstruction | null>(null);
  const [creating, setCreating] = useState(false);

  const save = (item: LibraryInstruction) => {
    const exists = items.find((x) => x.id === item.id);
    upsertLibraryInstruction(item);
    logActivity({
      adminId, adminName, role: adminRole,
      action: "settings_change", entity: "library_instruction", entityId: item.id,
      details: exists ? `تعديل تعليمة "${item.titleAr}"` : `إضافة تعليمة "${item.titleAr}"`,
    });
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };
  const remove = (item: LibraryInstruction) => {
    if (!window.confirm(`حذف "${item.titleAr}"؟`)) return;
    deleteLibraryInstruction(item.id);
    logActivity({
      adminId, adminName, role: adminRole,
      action: "settings_change", entity: "library_instruction", entityId: item.id,
      details: `حذف تعليمة "${item.titleAr}"`,
    });
    toast.success("تم الحذف");
  };
  const toggle = (item: LibraryInstruction) => {
    setLibraryInstructionActive(item.id, !item.isActive);
    toast.success(item.isActive ? "تم الإيقاف" : "تم التفعيل");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">{items.length} تعليمة</p>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={13} aria-hidden="true" /> إضافة تعليمة
        </Button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="text-start py-2 px-3 font-semibold">العنوان</th>
              <th className="text-start py-2 px-3 font-semibold">المفتاح</th>
              <th className="text-start py-2 px-3 font-semibold">أولوية</th>
              <th className="text-start py-2 px-3 font-semibold">الحالة</th>
              <th className="text-end py-2 px-3 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={5} className="text-center text-gray-400 py-6 text-xs">لا توجد تعليمات بعد</td></tr>
            )}
            {[...items].sort((a, b) => a.priority - b.priority).map((it) => (
              <tr key={it.id} className="border-b border-gray-50 last:border-0">
                <td className="py-2.5 px-3">
                  <p className="text-sm font-semibold text-[#164E63]">{it.titleAr}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{it.bodyAr}</p>
                </td>
                <td className="py-2.5 px-3 text-[11px] lat" dir="ltr">{it.key}</td>
                <td className="py-2.5 px-3 text-xs text-gray-500">{it.priority}</td>
                <td className="py-2.5 px-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${it.isActive ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                    {it.isActive ? "نشطة" : "موقوفة"}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-end">
                  <div className="inline-flex items-center gap-1">
                    <button onClick={() => toggle(it)} className={`text-[10px] px-2 py-1 rounded-md cursor-pointer ${it.isActive ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {it.isActive ? "إيقاف" : "تفعيل"}
                    </button>
                    <button onClick={() => setEditing(it)} aria-label="تعديل" className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center cursor-pointer">
                      <Pencil size={13} className="text-gray-500" aria-hidden="true" />
                    </button>
                    <button onClick={() => remove(it)} aria-label="حذف" className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer">
                      <Trash2 size={13} className="text-red-400" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <InstructionFormDrawer
          initial={editing ?? undefined}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSubmit={save}
        />
      )}
    </div>
  );
}

function InstructionFormDrawer({ initial, onCancel, onSubmit }: {
  initial?: LibraryInstruction;
  onCancel: () => void;
  onSubmit: (i: LibraryInstruction) => void;
}) {
  const [d, setD] = useState<LibraryInstruction>(() => initial ?? {
    id: `li-${Date.now().toString(36)}`,
    key: "", titleAr: "", bodyAr: "", icon: "clock", priority: 50, isActive: true,
  });
  const set = <K extends keyof LibraryInstruction>(k: K, v: LibraryInstruction[K]) => setD((x) => ({ ...x, [k]: v }));
  const canSubmit = d.key.trim() && d.titleAr.trim();
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] flex">
      <button type="button" aria-label="إلغاء" onClick={onCancel} className="flex-1 bg-black/50 cursor-pointer" />
      <div className="bg-white w-full max-w-md h-full overflow-hidden flex flex-col shadow-[0_0_40px_rgba(0,0,0,0.18)]">
        <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-bold text-[#164E63]">{initial ? "تعديل تعليمة" : "إضافة تعليمة"}</h3>
          <button onClick={onCancel} aria-label="إغلاق" className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer"><X size={16} aria-hidden="true" /></button>
        </header>
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          <Field label="المفتاح (للإلغاء التكرار) *">
            <input value={d.key} onChange={(e) => set("key", e.target.value.trim())} placeholder="fasting_8h" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
            <p className="text-[11px] text-gray-400 mt-1">يُستخدم لتجميع نفس التعليمة من تحاليل مختلفة في نفس الطلب.</p>
          </Field>
          <Field label="العنوان بالعربية *">
            <input value={d.titleAr} onChange={(e) => set("titleAr", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
          </Field>
          <Field label="المحتوى">
            <textarea value={d.bodyAr} onChange={(e) => set("bodyAr", e.target.value)} rows={3} className="w-full p-3 rounded-xl border border-gray-200 text-sm resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الأيقونة (lucide token)">
              <input value={d.icon} onChange={(e) => set("icon", e.target.value)} placeholder="clock / droplets / pill / id-card / shirt" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
            </Field>
            <Field label="الأولوية">
              <input type="number" value={d.priority} onChange={(e) => set("priority", Number(e.target.value))} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-[#164E63]">
            <input type="checkbox" checked={d.isActive} onChange={(e) => set("isActive", e.target.checked)} className="w-4 h-4" />
            نشطة (تظهر للعملاء)
          </label>
        </div>
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 flex-shrink-0">
          <Button size="md" variant="outline" onClick={onCancel}>إلغاء</Button>
          <Button size="md" variant="primary" disabled={!canSubmit} onClick={() => onSubmit(d)}>
            <Save size={13} aria-hidden="true" /> حفظ
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ─── Tools tab ───────────────────────────────────────────────────────────────
function ToolsTab({ adminId, adminName, adminRole }: Props) {
  const items = useLibraryTools();
  const toast = useToast();
  const [editing, setEditing] = useState<LibraryTool | null>(null);
  const [creating, setCreating] = useState(false);

  const save = (item: LibraryTool) => {
    const exists = items.find((x) => x.id === item.id);
    upsertLibraryTool(item);
    logActivity({
      adminId, adminName, role: adminRole,
      action: "settings_change", entity: "library_tool", entityId: item.id,
      details: exists ? `تعديل أداة "${item.nameAr}"` : `إضافة أداة "${item.nameAr}"`,
    });
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };
  const remove = (item: LibraryTool) => {
    if (!window.confirm(`حذف "${item.nameAr}"؟`)) return;
    deleteLibraryTool(item.id);
    logActivity({
      adminId, adminName, role: adminRole,
      action: "settings_change", entity: "library_tool", entityId: item.id,
      details: `حذف أداة "${item.nameAr}"`,
    });
    toast.success("تم الحذف");
  };
  const toggle = (item: LibraryTool) => {
    setLibraryToolActive(item.id, !item.isActive);
    toast.success(item.isActive ? "تم الإيقاف" : "تم التفعيل");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">{items.length} أداة</p>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={13} aria-hidden="true" /> إضافة أداة
        </Button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="text-start py-2 px-3 font-semibold">الأداة</th>
              <th className="text-start py-2 px-3 font-semibold">المعرّف</th>
              <th className="text-start py-2 px-3 font-semibold">الوحدة</th>
              <th className="text-start py-2 px-3 font-semibold">الحالة</th>
              <th className="text-end py-2 px-3 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={5} className="text-center text-gray-400 py-6 text-xs">لا توجد أدوات بعد</td></tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-b border-gray-50 last:border-0">
                <td className="py-2.5 px-3 text-sm font-semibold text-[#164E63]">{it.nameAr}</td>
                <td className="py-2.5 px-3 text-[11px] lat" dir="ltr">{it.id}</td>
                <td className="py-2.5 px-3 text-xs text-gray-500">{it.unit}</td>
                <td className="py-2.5 px-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${it.isActive ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                    {it.isActive ? "نشطة" : "موقوفة"}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-end">
                  <div className="inline-flex items-center gap-1">
                    <button onClick={() => toggle(it)} className={`text-[10px] px-2 py-1 rounded-md cursor-pointer ${it.isActive ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {it.isActive ? "إيقاف" : "تفعيل"}
                    </button>
                    <button onClick={() => setEditing(it)} aria-label="تعديل" className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center cursor-pointer">
                      <Pencil size={13} className="text-gray-500" aria-hidden="true" />
                    </button>
                    <button onClick={() => remove(it)} aria-label="حذف" className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer">
                      <Trash2 size={13} className="text-red-400" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <ToolFormDrawer
          initial={editing ?? undefined}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSubmit={save}
        />
      )}
    </div>
  );
}

function ToolFormDrawer({ initial, onCancel, onSubmit }: {
  initial?: LibraryTool;
  onCancel: () => void;
  onSubmit: (t: LibraryTool) => void;
}) {
  const [d, setD] = useState<LibraryTool>(() => initial ?? {
    id: `tl-${Date.now().toString(36)}`, nameAr: "", unit: "حبة", isActive: true,
  });
  const set = <K extends keyof LibraryTool>(k: K, v: LibraryTool[K]) => setD((x) => ({ ...x, [k]: v }));
  const canSubmit = d.nameAr.trim() && d.id.trim() && d.unit.trim();
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] flex">
      <button type="button" aria-label="إلغاء" onClick={onCancel} className="flex-1 bg-black/50 cursor-pointer" />
      <div className="bg-white w-full max-w-md h-full overflow-hidden flex flex-col shadow-[0_0_40px_rgba(0,0,0,0.18)]">
        <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-bold text-[#164E63]">{initial ? "تعديل أداة" : "إضافة أداة"}</h3>
          <button onClick={onCancel} aria-label="إغلاق" className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer"><X size={16} aria-hidden="true" /></button>
        </header>
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          <Field label="المعرّف *">
            <input value={d.id} onChange={(e) => set("id", e.target.value.trim())} disabled={!!initial} placeholder="tl-xxx" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50 lat" dir="ltr" />
          </Field>
          <Field label="الاسم بالعربية *">
            <input value={d.nameAr} onChange={(e) => set("nameAr", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
          </Field>
          <Field label="وحدة العرض *">
            <input value={d.unit} onChange={(e) => set("unit", e.target.value)} placeholder="حبة / أنبوب / عبوة / زوج" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-[#164E63]">
            <input type="checkbox" checked={d.isActive} onChange={(e) => set("isActive", e.target.checked)} className="w-4 h-4" />
            نشطة (تُحتسب في قائمة التحضير)
          </label>
        </div>
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 flex-shrink-0">
          <Button size="md" variant="outline" onClick={onCancel}>إلغاء</Button>
          <Button size="md" variant="primary" disabled={!canSubmit} onClick={() => onSubmit(d)}>
            <Save size={13} aria-hidden="true" /> حفظ
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ─── Defaults tab ────────────────────────────────────────────────────────────
function DefaultsTab({ adminId, adminName, adminRole }: Props) {
  const live = useChecklistDefaults();
  const tools = useLibraryTools();
  const toast = useToast();
  const [draft, setDraft] = useState({ ...live });
  const [saving, setSaving] = useState(false);

  const dirty =
    draft.bufferPct !== live.bufferPct ||
    JSON.stringify([...draft.defaultToolIds].sort()) !== JSON.stringify([...live.defaultToolIds].sort());

  const toggleTool = (id: string) => {
    setDraft((d) => d.defaultToolIds.includes(id)
      ? { ...d, defaultToolIds: d.defaultToolIds.filter((x) => x !== id) }
      : { ...d, defaultToolIds: [...d.defaultToolIds, id] });
  };

  const save = async () => {
    setSaving(true);
    const r = updateChecklistDefaults(draft);
    setSaving(false);
    if (!r.ok) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    logActivity({
      adminId, adminName, role: adminRole,
      action: "settings_change", entity: "checklist_defaults", entityId: "global",
      details: `تحديث إعدادات قائمة التحضير (هامش ${draft.bufferPct}% · ${draft.defaultToolIds.length} أداة افتراضية)`,
    });
    toast.success("تم الحفظ بنجاح");
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 leading-relaxed">
        تُستخدم هذه الإعدادات لاحتساب قائمة التحضير الصباحية للممرض من جميع طلبات اليوم.
      </p>

      <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <h4 className="text-xs font-bold text-[#164E63]">الأدوات الافتراضية</h4>
        <p className="text-[11px] text-gray-500">تُضاف للقائمة دائماً مهما كانت الطلبات.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {tools.filter((t) => t.isActive).map((t) => {
            const checked = draft.defaultToolIds.includes(t.id);
            return (
              <label key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50 text-xs">
                <input type="checkbox" checked={checked} onChange={() => toggleTool(t.id)} className="w-4 h-4" />
                <span className="flex-1 text-[#164E63]">{t.nameAr}</span>
                <span className="text-gray-400">{t.unit}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
        <h4 className="text-xs font-bold text-[#164E63]">هامش الاحتياط (Buffer %)</h4>
        <p className="text-[11px] text-gray-500">يُضاف على الكميات المجمَّعة لتفادي النقص. مثال: 15% على 10 أنابيب = 12 أنبوب.</p>
        <div className="flex items-center gap-3">
          <input
            type="range" min={0} max={50} step={5}
            value={draft.bufferPct}
            onChange={(e) => setDraft((d) => ({ ...d, bufferPct: Number(e.target.value) }))}
            className="flex-1"
          />
          <span className="w-12 text-end text-sm font-bold text-[#164E63] lat" dir="ltr">{draft.bufferPct}%</span>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        <Button size="md" variant="primary" loading={saving} disabled={!dirty} onClick={save}>
          <Save size={13} aria-hidden="true" /> حفظ التغييرات
        </Button>
      </div>
    </div>
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
