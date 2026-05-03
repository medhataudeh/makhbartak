"use client";
import { useEffect, useState, useMemo } from "react";
import {
  LayoutGrid, ClipboardList, FlaskConical, Package as PackageIcon, Tag, Users,
  Building2, Settings, TrendingUp, Clock, CheckCircle, DollarSign, FileText,
  UserCog, Image as ImageIcon, Bell, Activity, Shapes, LogOut, Search, Menu,
  X, CreditCard, Eye, Trophy, Plus, Trash2, Pencil,
  ChevronUp, ChevronDown, ChevronLeft, Route, MapPin, Wrench,
} from "lucide-react";
import {
  MOCK_ORDERS, ADMIN_STATS, MOCK_TESTS, MOCK_PACKAGES,
  ORDER_STATUS_LABELS, MOCK_INVOICES,
  MOCK_ICONS, MOCK_SLIDERS, MOCK_PATIENTS, MOCK_ADDRESSES, MOCK_NOTIFICATIONS, SEED_CUSTOMER_1_ID,
  MOCK_COUPONS, MOCK_NURSE_ROUTES, MOCK_GAMIFICATION,
  NURSE_LEVELS, NURSE_BADGES, GAMIFICATION_CONFIG, canAccess,
} from "@/lib/mock-data";
import { ROLE_LABELS, ACTIVITY_LABELS } from "@/lib/types";
import type {
  AdminUser, Invoice, PaymentStatus, AdminRole, Order,
  Test, Package, Coupon, Nurse, SliderItem, SvgIcon, Notification,
  NurseRoute,
} from "@/lib/types";
import { formatDate, formatPrice, relativeTime } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { InvoiceView } from "@/components/admin/InvoiceView";
import { OrderControlCenter } from "@/components/admin/OrderControlCenter";
import { CredentialsShareSheet, generateTempPassword, type ShareableCredentials } from "@/components/admin/CredentialsShareSheet";
import { MediaPicker } from "@/components/admin/MediaPicker";
import { MediaLibraryAdmin } from "@/components/admin/MediaLibraryAdmin";
import { LabsAdmin } from "@/components/admin/LabsAdmin";
import { BrandingAdmin } from "@/components/admin/BrandingAdmin";
import { ContentAdmin } from "@/components/admin/ContentAdmin";
import { LibrariesAdmin } from "@/components/admin/LibrariesAdmin";
import { ShortageRequestsAdmin } from "@/components/admin/ShortageRequestsAdmin";
import { useLibraryInstructions } from "@/lib/instruction-library";
import { useLibraryTools } from "@/lib/tool-library";
import { AdminUserContext } from "@/components/admin/AdminContext";
import { useCurrentAdmin } from "@/components/admin/AdminContext";
import { useOrders, createOrder, hydrateOrdersForAdmin } from "@/lib/store";
import { generateOrderNumber, dedupeInstructions } from "@/lib/order-utils";
import { COMMON_INSTRUCTIONS } from "@/lib/mock-data";
import { useActivityLogs, hydrateActivityLogs } from "@/lib/activity-log";
import {
  hydrateAdminTests, hydrateAdminPackages, hydrateAdminCoupons, hydrateAdminSliders,
  hydrateAdminNurses, hydrateAdminLabs, apiPatchNurse,
  apiUpsertTest, apiDeleteTest,
  apiUpsertPackage, apiDeletePackage,
  apiUpsertCoupon, apiDeleteCoupon, apiValidateCoupon,
  apiUpsertSlider, apiDeleteSlider,
} from "@/lib/admin-catalog-api";
import type { Lab } from "@/lib/types";
import { logActivity } from "@/lib/activity-log";
import { useToast } from "@/components/ui/Toast";
import { useSystemSettings, updateSystemSettings } from "@/lib/system-settings";
import {
  useAdmins, upsertAdmin, deleteAdmin, setAdminActive,
  useCustomerUsers, upsertCustomerUser, deleteCustomerUser, setCustomerUserActive, resetCustomerUserPassword,
  useNurseUsers, upsertNurseUser, deleteNurseUser, setNurseUserActive, resetNurseUserPassword,
  useSession,
} from "@/lib/auth";

interface AdminDashboardProps {
  user: AdminUser;
  onLogout: () => void;
}

type AdminSection =
  | "overview" | "orders" | "users" | "tests" | "packages" | "coupons"
  | "nurses" | "scheduling" | "gamification" | "labs" | "shortages"
  | "payments" | "invoices" | "sliders" | "icons" | "branding" | "content"
  | "libraries" | "media"
  | "notifications" | "admins" | "activity" | "settings";

interface SectionDef {
  id: AdminSection;
  label: string;
  Icon: React.FC<{ size?: number }>;
  group: "ops" | "catalog" | "operations" | "content" | "finance" | "system";
}

// Note: Patients, Addresses, and Lab-Results are intentionally NOT standalone
// admin pages. Patients/Addresses live inside each user's profile drawer.
// Lab result files live inside each order detail.
const SECTIONS: SectionDef[] = [
  { id: "overview",      label: "لوحة المعلومات",  Icon: LayoutGrid,    group: "ops"        },
  { id: "orders",        label: "الطلبات",          Icon: ClipboardList, group: "ops"        },
  { id: "users",         label: "المستخدمون",       Icon: Users,         group: "ops"        },

  { id: "tests",         label: "التحاليل",         Icon: FlaskConical,  group: "catalog"    },
  { id: "packages",      label: "الباقات",          Icon: PackageIcon,   group: "catalog"    },
  { id: "coupons",       label: "الكوبونات",        Icon: Tag,           group: "catalog"    },
  { id: "libraries",     label: "المكتبات",         Icon: Shapes,        group: "catalog"    },

  { id: "nurses",        label: "الممرضون",         Icon: Users,         group: "operations" },
  { id: "scheduling",    label: "جدولة الزيارات",   Icon: Route,         group: "operations" },
  { id: "gamification",  label: "نقاط الممرضين",    Icon: Trophy,        group: "operations" },
  { id: "labs",          label: "المخابر",          Icon: Building2,     group: "operations" },
  { id: "shortages",     label: "طلبات الأدوات",    Icon: Wrench,        group: "operations" },

  { id: "invoices",      label: "الفواتير",         Icon: FileText,      group: "finance"    },
  { id: "payments",      label: "المدفوعات",        Icon: CreditCard,    group: "finance"    },

  { id: "media",         label: "مكتبة الوسائط",     Icon: ImageIcon,     group: "content"    },
  { id: "sliders",       label: "السلايدر الرئيسي", Icon: ImageIcon,     group: "content"    },
  { id: "icons",         label: "الأيقونات",        Icon: Shapes,        group: "content"    },
  { id: "branding",      label: "الشعارات والهوية", Icon: ImageIcon,     group: "content"    },
  { id: "content",       label: "محتوى الصفحات",   Icon: FileText,      group: "content"    },
  { id: "notifications", label: "الإشعارات",        Icon: Bell,          group: "content"    },

  { id: "admins",        label: "الموظفون والأدوار",Icon: UserCog,       group: "system"     },
  { id: "activity",      label: "سجل النشاط",       Icon: Activity,      group: "system"     },
  { id: "settings",      label: "الإعدادات",        Icon: Settings,      group: "system"     },
];

const GROUP_LABELS: Record<SectionDef["group"], string> = {
  ops: "العمليات اليومية", catalog: "الكتالوج", operations: "الميدان",
  content: "المحتوى", finance: "المالية", system: "النظام",
};

export function AdminDashboard({ user, onLogout }: AdminDashboardProps) {
  const accessible = useMemo(
    () => SECTIONS.filter((s) => canAccess(user.role, s.id)),
    [user.role],
  );
  const [section, setSection] = useState<AdminSection>(accessible[0]?.id ?? "overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Centralized mutable state — single source of truth so child sections can
  // CRUD without prop-drilling and changes survive across tab switches.
  // Stage F follow-up: tests/packages/coupons/sliders are seeded from mock
  // for the first paint and replaced by Supabase rows once the hydrators
  // below resolve. Edits awaited via /api/admin/* before local state moves.
  const [tests, setTests]                 = useState<Test[]>(MOCK_TESTS);
  const [packages, setPackages]           = useState<Package[]>(MOCK_PACKAGES);
  const [coupons, setCoupons]             = useState<Coupon[]>(MOCK_COUPONS);
  // Operational rosters that admin assigns to orders. Seed empty so the
  // dropdown only ever shows real DB rows; hydration below replaces it. The
  // assignment APIs reject non-existent ids, so any stale mock UUID would
  // produce a 404 — we don't want that.
  const [nurses, setNurses]               = useState<Nurse[]>([]);
  const [labs, setLabs]                   = useState<Lab[]>([]);
  const [sliders, setSliders]             = useState<SliderItem[]>(MOCK_SLIDERS);
  const [icons, setIcons]                 = useState<SvgIcon[]>(MOCK_ICONS);
  const [orders, setOrders]               = useState<Order[]>(MOCK_ORDERS);
  const [routes, setRoutes]               = useState<NurseRoute[]>(MOCK_NURSE_ROUTES);
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS);
  const [config, setConfig]               = useState(GAMIFICATION_CONFIG);

  // Hydrate catalog from Supabase. Tests load first because packages are
  // mapped through the test list (server returns ids; we resolve to objects).
  // Nurses + labs hydrate in parallel so the order-control dropdowns are
  // ready by the time the admin clicks into an order.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [remoteTests, remoteNurses, remoteLabs] = await Promise.all([
        hydrateAdminTests(),
        hydrateAdminNurses(),
        hydrateAdminLabs(),
      ]);
      if (cancelled) return;
      if (remoteTests) setTests(remoteTests);
      if (remoteNurses) setNurses(remoteNurses);
      if (remoteLabs) setLabs(remoteLabs);
      const [remotePackages, remoteCoupons, remoteSliders] = await Promise.all([
        hydrateAdminPackages(remoteTests ?? MOCK_TESTS),
        hydrateAdminCoupons(),
        hydrateAdminSliders(),
      ]);
      if (cancelled) return;
      if (remotePackages) setPackages(remotePackages);
      if (remoteCoupons) setCoupons(remoteCoupons);
      if (remoteSliders) setSliders(remoteSliders);
    })();
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const out: Record<string, SectionDef[]> = {};
    accessible.forEach((s) => { out[s.group] ??= []; out[s.group].push(s); });
    return out;
  }, [accessible]);

  return (
    <AdminUserContext.Provider value={user}>
    <div className="min-h-screen bg-gray-50 flex">
      {sidebarOpen && (
        <button
          aria-label="إغلاق القائمة"
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden fixed inset-0 bg-black/40 z-40 cursor-pointer"
        />
      )}

      <aside
        className={`fixed lg:sticky top-0 h-screen w-72 bg-white border-s border-gray-100 z-50 flex flex-col transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        }`}
        style={{ insetInlineStart: 0 }}
      >
        <div className="px-5 py-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#ECFEFF] flex items-center justify-center flex-shrink-0">
              <FlaskConical size={20} className="text-[#0891B2]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#164E63] truncate">لوحة الإدارة</p>
              <p className="text-[11px] text-gray-400 truncate">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="إغلاق"
            className="lg:hidden w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {(Object.keys(grouped) as SectionDef["group"][]).map((group) => (
            <div key={group}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-3 mb-1.5">
                {GROUP_LABELS[group]}
              </p>
              <div className="space-y-0.5">
                {grouped[group].map((s) => {
                  const isActive = section === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => { setSection(s.id); setSidebarOpen(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium cursor-pointer transition-colors ${
                        isActive ? "bg-[#ECFEFF] text-[#0891B2]" : "text-gray-600 hover:bg-gray-50"
                      }`}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <s.Icon size={15} aria-hidden="true" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-gray-100 p-3">
          <div className="px-2 mb-2">
            <p className="text-sm font-semibold text-[#164E63] truncate">{user.name}</p>
            <p className="text-[11px] text-gray-400 lat" dir="ltr">{user.username}</p>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-50 cursor-pointer transition-colors"
          >
            <LogOut size={15} aria-hidden="true" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="فتح القائمة"
            className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <p className="text-sm font-semibold text-[#164E63]">
            {SECTIONS.find((s) => s.id === section)?.label}
          </p>
          <div className="w-9" />
        </div>

        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          <div className="hidden lg:flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#164E63]">
                {SECTIONS.find((s) => s.id === section)?.label}
              </h1>
              <p className="text-sm text-gray-500 mt-1">{formatDate(new Date().toISOString())}</p>
            </div>
          </div>

          {section === "overview"      && <Overview orders={orders} />}
          {section === "orders"        && <OrdersAdmin orders={orders} setOrders={setOrders} nurses={nurses} labs={labs} user={user} />}
          {section === "users"         && <UsersAdmin orders={orders} />}
          {section === "tests"         && <TestsAdmin tests={tests} setTests={setTests} />}
          {section === "packages"      && <PackagesAdmin packages={packages} setPackages={setPackages} tests={tests} />}
          {section === "coupons"       && <CouponsAdmin coupons={coupons} setCoupons={setCoupons} />}
          {section === "nurses"        && <NursesAdmin nurses={nurses} setNurses={setNurses} />}
          {section === "scheduling"    && <SchedulingAdmin nurses={nurses} routes={routes} setRoutes={setRoutes} orders={orders} />}
          {section === "gamification"  && <GamificationAdmin nurses={nurses} config={config} setConfig={setConfig} />}
          {section === "labs"          && <LabsAdmin adminId={user.id} adminName={user.name} adminRole={user.role} />}
          {section === "shortages"     && <ShortageRequestsAdmin adminId={user.id} adminName={user.name} adminRole={user.role} />}
          {section === "payments"      && <PaymentsAdmin />}
          {section === "invoices"      && <InvoicesAdmin />}
          {section === "media"         && <MediaLibraryAdmin />}
          {section === "sliders"       && <SlidersAdmin sliders={sliders} setSliders={setSliders} packages={packages} />}
          {section === "icons"         && <IconsAdmin icons={icons} setIcons={setIcons} />}
          {section === "branding"      && <BrandingAdmin adminId={user.id} adminName={user.name} adminRole={user.role} />}
          {section === "content"       && <ContentAdmin  adminId={user.id} adminName={user.name} adminRole={user.role} />}
          {section === "libraries"     && <LibrariesAdmin adminId={user.id} adminName={user.name} adminRole={user.role} />}
          {section === "notifications" && <NotificationsAdmin notifications={notifications} setNotifications={setNotifications} />}
          {section === "admins"        && <AdminsAdmin currentUser={user} />}
          {section === "activity"      && <ActivityAdmin />}
          {section === "settings"      && <SettingsAdmin />}
        </main>
      </div>
    </div>
    </AdminUserContext.Provider>
  );
}

// ════════════════════════════ Building blocks ═══════════════════════════════

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-4 md:p-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-sm font-bold text-[#164E63]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className={`rounded-2xl p-4 md:p-5 ${color}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium opacity-90 mb-1">{label}</p>
          <p className="text-2xl md:text-3xl font-bold">{value}</p>
        </div>
        <div className="opacity-90">{icon}</div>
      </div>
    </div>
  );
}

function DataTable<T>({ rows, columns, empty, page = 1, pageSize = 10, onPage }: {
  rows: T[];
  columns: { key: string; label: string; render: (row: T) => React.ReactNode; className?: string }[];
  empty?: string;
  page?: number;
  pageSize?: number;
  onPage?: (n: number) => void;
}) {
  if (rows.length === 0) {
    return <div className="py-10 text-center text-sm text-gray-400">{empty ?? "لا توجد بيانات"}</div>;
  }
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = onPage ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;

  return (
    <div>
      <div className="overflow-x-auto -mx-4 md:mx-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 text-start ${c.className ?? ""}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-3 align-middle text-[#164E63] ${c.className ?? ""}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onPage && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-3 text-xs text-gray-500">
          <span>الصفحة {page} من {totalPages} · {rows.length} عنصر</span>
          <div className="flex gap-1">
            <button
              onClick={() => onPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >السابق</button>
            <button
              onClick={() => onPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >التالي</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500 mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 rounded-xl border border-gray-200 text-sm text-[#164E63] focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/15 outline-none transition-all ${props.className ?? ""}`}
    />
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors cursor-pointer ${checked ? "bg-[#059669]" : "bg-gray-300"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${checked ? "-translate-x-1" : "-translate-x-5"}`} />
    </button>
  );
}

function Pill({ children, color = "gray" }: { children: React.ReactNode; color?: "gray" | "green" | "red" | "amber" | "cyan" | "purple" }) {
  const map = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-700",
    cyan: "bg-[#ECFEFF] text-[#0891B2]",
    purple: "bg-purple-50 text-purple-700",
  } as const;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${map[color]}`}>{children}</span>;
}

function Modal({ title, onClose, size = "md", children }: { title: string; onClose: () => void; size?: "sm" | "md" | "lg" | "xl"; children: React.ReactNode }) {
  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-3 md:p-6">
      <div className={`bg-white w-full ${widths[size]} rounded-2xl overflow-hidden flex flex-col max-h-[92vh]`}>
        <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-bold text-[#164E63]">{title}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, onConfirm, onCancel, danger }: { title: string; message: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  return (
    <Modal title={title} onClose={onCancel} size="sm">
      <p className="text-sm text-gray-600 leading-relaxed mb-4">{message}</p>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
        <Button variant={danger ? "danger" : "primary"} className="flex-1" onClick={onConfirm}>تأكيد</Button>
      </div>
    </Modal>
  );
}

function ActionMenu<T>({ row, onEdit, onDelete, onToggle, isActive }: {
  row: T;
  onEdit: (r: T) => void;
  onDelete: (r: T) => void;
  onToggle?: (r: T) => void;
  isActive?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 justify-end">
      {onToggle && (
        <button
          onClick={() => onToggle(row)}
          aria-label={isActive ? "إيقاف" : "تفعيل"}
          className={`text-[10px] px-2 py-1 rounded-md cursor-pointer ${isActive ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
        >
          {isActive ? "إيقاف" : "تفعيل"}
        </button>
      )}
      <button onClick={() => onEdit(row)} aria-label="تعديل" className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center cursor-pointer">
        <Pencil size={13} className="text-gray-500" aria-hidden="true" />
      </button>
      <button onClick={() => onDelete(row)} aria-label="حذف" className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer">
        <Trash2 size={13} className="text-red-400" aria-hidden="true" />
      </button>
    </div>
  );
}

// ════════════════════════════ Overview ══════════════════════════════════════

function Overview({ orders }: { orders: Order[] }) {
  const recentLogs = useActivityLogs().slice(0, 5);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<TrendingUp size={20} />} label="طلبات اليوم" value={ADMIN_STATS.todayOrders} color="bg-[#0891B2] text-white" />
        <StatCard icon={<Clock size={20} />} label="قيد الانتظار" value={ADMIN_STATS.pendingOrders} color="bg-amber-500 text-white" />
        <StatCard icon={<CheckCircle size={20} />} label="مكتملة اليوم" value={ADMIN_STATS.completedToday} color="bg-[#059669] text-white" />
        <StatCard icon={<DollarSign size={20} />} label="الإيرادات (ل.س)" value={ADMIN_STATS.revenue.toLocaleString("ar")} color="bg-purple-600 text-white" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Section title="آخر الطلبات">
            <DataTable
              rows={orders.slice(0, 5)}
              columns={[
                { key: "id", label: "الطلب", render: (o) => <span className="lat" dir="ltr">{o.id}</span> },
                { key: "patient", label: "المريض", render: (o) => o.patient.name },
                { key: "status", label: "الحالة", render: (o) => <StatusBadge status={o.status} /> },
                { key: "total", label: "المجموع", render: (o) => formatPrice(o.total) },
              ]}
            />
          </Section>
        </div>
        <Section title="آخر النشاطات">
          <ul className="space-y-3">
            {recentLogs.map((log) => (
              <li key={log.id} className="text-xs">
                <p className="text-[#164E63] font-semibold">{log.adminName}</p>
                <p className="text-gray-500 leading-snug">{ACTIVITY_LABELS[log.action]} — {log.details}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{relativeTime(log.createdAt)}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

// ════════════════════════════ Orders ════════════════════════════════════════

function OrdersAdmin({ nurses, labs, user }: { orders: Order[]; setOrders: React.Dispatch<React.SetStateAction<Order[]>>; nurses: Nurse[]; labs: Lab[]; user: AdminUser }) {
  // Read from the live store so quick-actions in the Control Center reflect
  // back into this list immediately (and into the customer + nurse views).
  const orders = useOrders();

  // Phase 1: pull persisted orders from Supabase on mount when the flag is on.
  useEffect(() => { void hydrateOrdersForAdmin(); }, []);

  // Combinable filters — all persistent within the session via component state.
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [nurseFilter, setNurseFilter] = useState<string>("all");
  const [labFilter, setLabFilter] = useState<string>("all");
  const [hasIssuesFilter, setHasIssuesFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // When the admin clicks "عرض تفاصيل العميل" inside the OCC, push the user
  // profile inline (back arrow returns to the OCC).
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const open = openId ? orders.find((o) => o.id === openId) ?? null : null;

  const statuses = Object.keys(ORDER_STATUS_LABELS);
  // Distinct cities from the live order set.
  const cities = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => set.add(o.address.city));
    return Array.from(set);
  }, [orders]);

  const matchesSearch = (o: Order, q: string) => {
    if (!q) return true;
    const s = q.toLowerCase();
    const candidates = [
      o.id, o.publicNumber ?? "", o.patient.name, o.address.city, o.address.label,
    ];
    return candidates.some((c) => c.toLowerCase().includes(s));
  };

  const filtered = orders.filter((o) => {
    if (statusFilter        !== "all" && o.status        !== statusFilter)        return false;
    if (paymentStatusFilter !== "all" && o.paymentStatus !== paymentStatusFilter) return false;
    if (typeFilter          !== "all" && o.type          !== typeFilter)          return false;
    if (cityFilter          !== "all" && o.address.city  !== cityFilter)          return false;
    if (nurseFilter         !== "all" && (o.nurseId ?? "") !== nurseFilter)       return false;
    if (labFilter           !== "all" && (o.labId   ?? "") !== labFilter)         return false;
    if (hasIssuesFilter && !((o.issues?.length ?? 0) > 0 || o.status === "lab_issue")) return false;
    if (dateFrom && o.visitDate < dateFrom) return false;
    if (dateTo   && o.visitDate > dateTo)   return false;
    if (!matchesSearch(o, search)) return false;
    return true;
  });

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) +
    (paymentStatusFilter !== "all" ? 1 : 0) +
    (typeFilter !== "all" ? 1 : 0) +
    (cityFilter !== "all" ? 1 : 0) +
    (nurseFilter !== "all" ? 1 : 0) +
    (labFilter !== "all" ? 1 : 0) +
    (hasIssuesFilter ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  const resetFilters = () => {
    setStatusFilter("all"); setPaymentStatusFilter("all"); setTypeFilter("all");
    setCityFilter("all"); setNurseFilter("all"); setLabFilter("all");
    setHasIssuesFilter(false); setDateFrom(""); setDateTo("");
    setSearch(""); setPage(1);
  };

  // When an order is open, render the OCC inline as a full-page detail view
  // (admin "no popups" rule). The list collapses; a back arrow returns.
  // Pushed user-profile view from inside an open OCC. Back returns to the OCC,
  // not to the orders list — preserves the admin's order context.
  if (open && openUserId) {
    const userOrders = orders.filter((o) => o.userId === openUserId);
    const userOf = userOrders[0];
    const userObj = userOf
      ? { id: openUserId, name: userOf.patient.name, phone: "+963 911 000 000", isActive: true }
      : { id: openUserId, name: "—", phone: "—", isActive: true };
    return (
      <UserProfilePanel
        user={userObj}
        orders={userOrders}
        onBack={() => setOpenUserId(null)}
      />
    );
  }

  if (open) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOpenId(null)}
            aria-label="رجوع"
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer"
          >
            <ChevronLeft size={16} className="rotate-180 text-[#164E63]" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] text-gray-400">الطلبات</p>
            <h2 className="text-base font-bold text-[#164E63] truncate">
              تفاصيل الطلب <span className="lat" dir="ltr">{open.publicNumber ?? open.id}</span>
            </h2>
          </div>
        </div>
        <OrderControlCenter
          inline
          order={open}
          role={{ role: user.role, actor: "admin", actorName: user.name, adminId: user.id }}
          nurses={nurses}
          labs={labs}
          onClose={() => setOpenId(null)}
          onOpenUser={(uid) => setOpenUserId(uid)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top bar: search + new order */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
          <TextInput
            placeholder="بحث: رقم الطلب، الهاتف، المريض، المدينة"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="ps-9"
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={13} aria-hidden="true" /> إنشاء طلب جديد
        </Button>
      </div>

      {/* Advanced filters — combinable */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[#164E63]">
            مرشحات متقدمة {activeFilterCount > 0 && <span className="text-[#0891B2]">· {activeFilterCount}</span>}
          </p>
          {activeFilterCount > 0 && (
            <button onClick={resetFilters} className="text-[11px] text-gray-500 cursor-pointer hover:text-[#164E63]">
              مسح المرشحات
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer" aria-label="تصفية الحالة">
            <option value="all">كل الحالات</option>
            {statuses.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]?.ar}</option>)}
          </select>
          <select value={paymentStatusFilter} onChange={(e) => { setPaymentStatusFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer" aria-label="حالة الدفع">
            <option value="all">حالة الدفع — الكل</option>
            <option value="pending">معلّق</option>
            <option value="paid">مدفوع</option>
            <option value="failed">فشل</option>
          </select>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer" aria-label="نوع الطلب">
            <option value="all">نوع الطلب — الكل</option>
            <option value="package">باقة</option>
            <option value="custom">تحاليل مختارة</option>
            <option value="prescription">وصفة</option>
          </select>
          <select value={cityFilter} onChange={(e) => { setCityFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer" aria-label="المدينة">
            <option value="all">المدينة — الكل</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={nurseFilter} onChange={(e) => { setNurseFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer" aria-label="الممرض">
            <option value="all">الممرض — الكل</option>
            <option value="">— غير معيّن —</option>
            {nurses.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          <select value={labFilter} onChange={(e) => { setLabFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer" aria-label="المخبر">
            <option value="all">المخبر — الكل</option>
            <option value="">— غير معيّن —</option>
            {labs.map((l) => <option key={l.id} value={l.id}>{l.nameAr}</option>)}
          </select>
          <input
            type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer" aria-label="من تاريخ"
            placeholder="من"
          />
          <input
            type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer" aria-label="إلى تاريخ"
            placeholder="إلى"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-[#164E63] cursor-pointer">
          <input type="checkbox" checked={hasIssuesFilter} onChange={(e) => { setHasIssuesFilter(e.target.checked); setPage(1); }} className="w-4 h-4" />
          إظهار الطلبات التي بها مشاكل فقط
        </label>
        <p className="text-[11px] text-gray-400">{filtered.length} نتيجة من أصل {orders.length}</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <DataTable
          rows={filtered}
          page={page} pageSize={10} onPage={setPage}
          empty="لا توجد طلبات تطابق البحث"
          columns={[
            { key: "ref",     label: "رقم",       render: (o) => <span className="lat font-semibold" dir="ltr">{o.publicNumber ?? o.id}</span> },
            { key: "patient", label: "المريض",     render: (o) => o.patient.name },
            { key: "city",    label: "المدينة",   render: (o) => <span className="text-xs text-gray-500">{o.address.city}</span> },
            { key: "date",    label: "الموعد",     render: (o) => <span className="text-xs text-gray-500">{formatDate(o.visitDate)}</span> },
            { key: "status",  label: "الحالة",     render: (o) => <StatusBadge status={o.status} /> },
            { key: "pay",     label: "الدفع",      render: (o) => <Pill color={o.paymentStatus === "paid" ? "green" : o.paymentStatus === "failed" ? "red" : "amber"}>{o.paymentStatus}</Pill> },
            { key: "total",   label: "المجموع",   render: (o) => <span className="font-bold">{formatPrice(o.total)}</span> },
            { key: "actions", label: "إجراءات",   render: (o) => (
              <button onClick={() => setOpenId(o.id)} className="text-xs px-2 py-1 rounded-md bg-[#ECFEFF] text-[#0891B2] cursor-pointer flex items-center gap-1">
                <Eye size={12} aria-hidden="true" /> فتح
              </button>
            )},
          ]}
        />
      </div>

      {creating && (
        <NewOrderDrawer
          user={user}
          nurses={nurses}
          labs={labs}
          onCancel={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setOpenId(id); }}
        />
      )}
    </div>
  );
}


// ════════════════════════════ Users (with patients/addresses inside) ════════

function UsersAdmin({ orders }: { orders: Order[] }) {
  // Build users list from patients (each patient.userId → user). In a real app,
  // users come from /users endpoint. For mock we synthesize.
  const users = useMemo(() => {
    const map = new Map<string, { id: string; name: string; phone: string; ordersCount: number; patientsCount: number; isActive: boolean }>();
    MOCK_PATIENTS.forEach((p) => {
      if (!map.has(p.userId)) map.set(p.userId, { id: p.userId, name: p.name, phone: "+963 911 000 000", ordersCount: 0, patientsCount: 0, isActive: true });
      map.get(p.userId)!.patientsCount += 1;
    });
    orders.forEach((o) => {
      if (!map.has(o.userId)) map.set(o.userId, { id: o.userId, name: o.patient.name, phone: "+963 911 000 000", ordersCount: 0, patientsCount: 0, isActive: true });
      map.get(o.userId)!.ordersCount += 1;
    });
    return Array.from(map.values());
  }, [orders]);

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<typeof users[number] | null>(null);

  const filtered = users.filter((u) => !search || u.id.includes(search) || u.name.includes(search) || u.phone.includes(search));

  // Inline page when a user is open (admin "no popups" rule).
  if (open) {
    return (
      <UserProfilePanel
        user={open}
        orders={orders.filter((o) => o.userId === open.id)}
        onBack={() => setOpen(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
          <TextInput placeholder="بحث بالاسم أو الهاتف" value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" />
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <DataTable
          rows={filtered}
          empty="لا يوجد مستخدمون"
          columns={[
            { key: "id",       label: "ID",       render: (u) => <span className="lat" dir="ltr">{u.id}</span> },
            { key: "name",     label: "الاسم",     render: (u) => u.name },
            { key: "phone",    label: "الهاتف",    render: (u) => <span className="lat" dir="ltr">{u.phone}</span> },
            { key: "orders",   label: "الطلبات",   render: (u) => u.ordersCount },
            { key: "patients", label: "المرضى",    render: (u) => u.patientsCount },
            { key: "status",   label: "الحالة",    render: (u) => u.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">موقوف</Pill> },
            { key: "actions",  label: "إجراءات",   render: (u) => (
              <button onClick={() => setOpen(u)} className="text-xs px-2 py-1 rounded-md bg-[#ECFEFF] text-[#0891B2] cursor-pointer flex items-center gap-1">
                <Eye size={12} aria-hidden="true" /> فتح ملف
              </button>
            )},
          ]}
        />
      </div>
    </div>
  );
}

function UserProfilePanel({ user, orders, onBack }: {
  user: { id: string; name: string; phone: string; isActive: boolean };
  orders: Order[];
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"profile" | "patients" | "addresses" | "orders" | "invoices" | "notifications">("profile");
  const userPatients = MOCK_PATIENTS.filter((p) => p.userId === user.id);
  const userAddresses = MOCK_ADDRESSES.filter((a) => a.userId === user.id);
  const userInvoices = MOCK_INVOICES.filter((i) => orders.some((o) => o.id === i.orderId));
  const userNotifs = MOCK_NOTIFICATIONS.filter((n) => orders.some((o) => o.id === n.orderId));

  return (
    <div className="space-y-4">
      {/* Inline page header with back arrow */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="رجوع"
          className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer"
        >
          <ChevronLeft size={16} className="rotate-180 text-[#164E63]" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <p className="text-[11px] text-gray-400">المستخدمون</p>
          <h2 className="text-base font-bold text-[#164E63] truncate">ملف المستخدم — {user.name}</h2>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex gap-2 border-b border-gray-100 mb-4 -mx-5 px-5 overflow-x-auto no-scrollbar">
        {([
          { v: "profile" as const,       label: "البيانات" },
          { v: "patients" as const,      label: `المرضى (${userPatients.length})` },
          { v: "addresses" as const,     label: `العناوين (${userAddresses.length})` },
          { v: "orders" as const,        label: `الطلبات (${orders.length})` },
          { v: "invoices" as const,      label: `الفواتير (${userInvoices.length})` },
          { v: "notifications" as const, label: `الإشعارات (${userNotifs.length})` },
        ]).map((t) => (
          <button
            key={t.v}
            onClick={() => setTab(t.v)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap cursor-pointer border-b-2 transition-colors ${
              tab === t.v ? "border-[#0891B2] text-[#0891B2]" : "border-transparent text-gray-500 hover:text-[#164E63]"
            }`}
            aria-current={tab === t.v ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="ID"><TextInput defaultValue={user.id} disabled /></Field>
          <Field label="الاسم"><TextInput defaultValue={user.name} /></Field>
          <Field label="الهاتف"><TextInput type="tel" defaultValue={user.phone} /></Field>
          <Field label="حالة الحساب">
            <select defaultValue={user.isActive ? "active" : "blocked"} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
              <option value="active">نشط</option>
              <option value="blocked">موقوف</option>
            </select>
          </Field>
          <div className="md:col-span-2 flex justify-end">
            <Button size="md">حفظ</Button>
          </div>
        </div>
      )}

      {tab === "patients" && (
        <DataTable
          rows={userPatients}
          empty="لا يوجد مرضى مسجّلون"
          columns={[
            { key: "name",    label: "الاسم",     render: (p) => p.name },
            { key: "default", label: "افتراضي",   render: (p) => p.isDefault ? <Pill color="green">نعم</Pill> : <Pill>لا</Pill> },
            { key: "actions", label: "إجراءات",   render: () => <span className="text-xs text-gray-400">تعديل · حذف</span> },
          ]}
        />
      )}

      {tab === "addresses" && (
        <DataTable
          rows={userAddresses}
          empty="لا توجد عناوين محفوظة"
          columns={[
            { key: "label",       label: "العنوان",   render: (a) => <span className="font-semibold">{a.label}</span> },
            { key: "description", label: "التفاصيل",  render: (a) => a.description },
            { key: "city",        label: "المدينة",   render: (a) => a.city },
            { key: "default",     label: "افتراضي",   render: (a) => a.isDefault ? <Pill color="green">نعم</Pill> : <Pill>لا</Pill> },
          ]}
        />
      )}

      {tab === "orders" && (
        <DataTable
          rows={orders}
          empty="لا توجد طلبات"
          columns={[
            { key: "id",      label: "الرقم",   render: (o) => <span className="lat" dir="ltr">{o.id}</span> },
            { key: "date",    label: "التاريخ", render: (o) => formatDate(o.visitDate) },
            { key: "status",  label: "الحالة",  render: (o) => <StatusBadge status={o.status} /> },
            { key: "total",   label: "المجموع", render: (o) => formatPrice(o.total) },
          ]}
        />
      )}

      {tab === "invoices" && (
        <DataTable
          rows={userInvoices}
          empty="لا توجد فواتير"
          columns={[
            { key: "n",      label: "الرقم",   render: (i) => <span className="lat" dir="ltr">{i.invoiceNumber}</span> },
            { key: "date",   label: "التاريخ", render: (i) => formatDate(i.issuedAt) },
            { key: "status", label: "الحالة",  render: (i) => <Pill color={i.paymentStatus === "paid" ? "green" : "amber"}>{i.paymentStatus}</Pill> },
            { key: "total",  label: "المجموع", render: (i) => formatPrice(i.total) },
          ]}
        />
      )}

      {tab === "notifications" && (
        <DataTable
          rows={userNotifs}
          empty="لا توجد إشعارات"
          columns={[
            { key: "title", label: "العنوان", render: (n) => n.titleAr },
            { key: "type",  label: "النوع",   render: (n) => <Pill color="cyan">{n.type}</Pill> },
            { key: "date",  label: "التاريخ", render: (n) => relativeTime(n.createdAt) },
          ]}
        />
      )}
      </div>
    </div>
  );
}

// ════════════════════════════ Tests CRUD ═══════════════════════════════════

function TestsAdmin({ tests, setTests }: { tests: Test[]; setTests: React.Dispatch<React.SetStateAction<Test[]>> }) {
  const me = useCurrentAdmin();
  const session = useSession();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Test | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Test | null>(null);

  const filtered = tests.filter((t) => !search || t.nameAr.includes(search) || t.nameEn.toLowerCase().includes(search.toLowerCase()));

  const upsert = async (t: Test) => {
    if (!session) { toast.error("الجلسة غير صالحة"); return; }
    const exists = tests.find((x) => x.id === t.id);
    const r = await apiUpsertTest(t);
    if (!r.ok || !r.test) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    const canonical = r.test;
    setTests((prev) => exists ? prev.map((x) => x.id === t.id ? canonical : x) : [...prev.filter((x) => x.id !== canonical.id), canonical]);
    logActivity({ adminId: me.id, adminName: me.name, role: me.role, action: "test_edit", entity: "test", entityId: canonical.id, details: exists ? `تعديل ${canonical.nameAr}` : `إضافة ${canonical.nameAr}` });
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
          <TextInput placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" />
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> إضافة تحليل</Button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <DataTable
          rows={filtered}
          empty="لا توجد تحاليل"
          columns={[
            { key: "name",   label: "العربي",   render: (t) => t.nameAr },
            { key: "en",     label: "الإنجليزي", render: (t) => <span className="lat text-gray-500" dir="ltr">{t.nameEn}</span> },
            { key: "short",  label: "الرمز",    render: (t) => <span className="lat" dir="ltr">{t.shortName}</span> },
            { key: "sample", label: "العينة",   render: (t) => t.sampleType === "blood" ? "دم" : t.sampleType === "urine" ? "بول" : t.sampleType },
            { key: "price",  label: "السعر",    render: (t) => <span className="font-bold">{formatPrice(t.sellPrice)}</span> },
            { key: "active", label: "حالة",     render: (t) => t.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">موقوف</Pill> },
            { key: "act",    label: "إجراءات",  render: (t) => (
              <ActionMenu row={t} isActive={t.isActive}
                onEdit={(r) => setEditing(r)}
                onDelete={(r) => setConfirmDelete(r)}
                onToggle={async (r) => {
                  if (!session) { toast.error("الجلسة غير صالحة"); return; }
                  const next = { ...r, isActive: !r.isActive };
                  const res = await apiUpsertTest(next);
                  if (!res.ok) { toast.error(res.error ?? "تعذر التحديث"); return; }
                  setTests((prev) => prev.map((x) => x.id === r.id ? next : x));
                  logActivity({ adminId: me.id, adminName: me.name, role: me.role, action: "test_edit", entity: "test", entityId: r.id, details: r.isActive ? `إيقاف ${r.nameAr}` : `تفعيل ${r.nameAr}` });
                  toast.success(r.isActive ? "تم الإيقاف" : "تم التفعيل");
                }}
              />
            )},
          ]}
        />
      </div>

      {(editing || creating) && (
        <TestForm
          initial={editing ?? undefined}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSubmit={upsert}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="حذف التحليل" message={`هل تريد حذف "${confirmDelete.nameAr}"؟ لا يمكن التراجع.`} danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            if (!session) { toast.error("الجلسة غير صالحة"); return; }
            const r = await apiDeleteTest(confirmDelete.id);
            if (!r.ok) { toast.error(r.error ?? "تعذر الحذف"); return; }
            setTests((prev) => prev.filter((x) => x.id !== confirmDelete.id));
            logActivity({ adminId: me.id, adminName: me.name, role: me.role, action: "test_edit", entity: "test", entityId: confirmDelete.id, details: `حذف ${confirmDelete.nameAr}` });
            toast.success("تم الحذف");
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function TestForm({ initial, onCancel, onSubmit }: { initial?: Test; onCancel: () => void; onSubmit: (t: Test) => void }) {
  const [draft, setDraft] = useState<Test>(() => initial ?? {
    id: `t-${Date.now()}`, nameAr: "", nameEn: "", shortName: "", aliasesAr: [], aliasesEn: [],
    categoryId: "cat-1", sampleType: "blood", costPrice: 0, sellPrice: 0,
    instructionsAr: [], tools: [],
    customerInstructions: [], nurseTools: [],
    isActive: true,
  });
  const set = <K extends keyof Test>(k: K, v: Test[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const libraryInstructions = useLibraryInstructions();
  const libraryTools = useLibraryTools();

  const customerInstructions = draft.customerInstructions ?? [];
  const nurseTools = draft.nurseTools ?? [];

  const addInstructionFromLibrary = (libId: string) => {
    const lib = libraryInstructions.find((l) => l.id === libId);
    if (!lib) return;
    if (customerInstructions.some((i) => i.key === lib.key)) return;
    set("customerInstructions", [...customerInstructions, {
      id: `ti-${draft.id}-${customerInstructions.length}`,
      key: lib.key, titleAr: lib.titleAr, bodyAr: lib.bodyAr,
      icon: lib.icon, priority: lib.priority, isActive: true,
    }]);
  };
  const removeInstruction = (id: string) =>
    set("customerInstructions", customerInstructions.filter((i) => i.id !== id));
  const updateInstruction = (id: string, patch: Partial<import("@/lib/types").TestInstruction>) =>
    set("customerInstructions", customerInstructions.map((i) => i.id === id ? { ...i, ...patch } : i));

  const addToolFromLibrary = (toolId: string) => {
    if (nurseTools.some((t) => t.toolId === toolId)) return;
    set("nurseTools", [...nurseTools, { toolId, quantityPerTest: 1, required: true }]);
  };
  const removeTool = (toolId: string) =>
    set("nurseTools", nurseTools.filter((t) => t.toolId !== toolId));
  const updateTool = (toolId: string, patch: Partial<import("@/lib/types").TestToolReq>) =>
    set("nurseTools", nurseTools.map((t) => t.toolId === toolId ? { ...t, ...patch } : t));

  return (
    <Modal title={initial ? "تعديل تحليل" : "إضافة تحليل"} onClose={onCancel} size="xl">
      <div className="space-y-5">
        {/* Basics */}
        <section>
          <h4 className="text-xs font-bold text-[#164E63] mb-3">البيانات الأساسية</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="الاسم العربي *"><TextInput value={draft.nameAr} onChange={(e) => set("nameAr", e.target.value)} /></Field>
            <Field label="الاسم الإنجليزي"><TextInput value={draft.nameEn} onChange={(e) => set("nameEn", e.target.value)} style={{ direction: "ltr", textAlign: "right" }} /></Field>
            <Field label="الرمز"><TextInput value={draft.shortName} onChange={(e) => set("shortName", e.target.value)} style={{ direction: "ltr", textAlign: "right" }} /></Field>
            <Field label="نوع العينة">
              <select value={draft.sampleType} onChange={(e) => set("sampleType", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
                <option value="blood">دم</option>
                <option value="urine">بول</option>
                <option value="saliva">لعاب</option>
              </select>
            </Field>
            <Field label="سعر التكلفة"><TextInput type="number" value={draft.costPrice} onChange={(e) => set("costPrice", Number(e.target.value))} /></Field>
            <Field label="سعر البيع *"><TextInput type="number" value={draft.sellPrice} onChange={(e) => set("sellPrice", Number(e.target.value))} /></Field>
          </div>
        </section>

        {/* Customer instructions — structured (deduplicated by key across order) */}
        <section className="bg-gray-50/40 rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-xs font-bold text-[#164E63]">تعليمات العميل</h4>
              <p className="text-[11px] text-gray-500">تظهر للعميل في صفحة تأكيد الطلب وتفاصيله. التعليمات ذات نفس المفتاح تُعرض مرة واحدة فقط حتى لو تكررت في عدة تحاليل.</p>
            </div>
            <select
              value=""
              onChange={(e) => { if (e.target.value) addInstructionFromLibrary(e.target.value); }}
              className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
              aria-label="إضافة من المكتبة"
            >
              <option value="">+ إضافة من المكتبة</option>
              {libraryInstructions.filter((l) => l.isActive && !customerInstructions.some((i) => i.key === l.key)).map((l) => (
                <option key={l.id} value={l.id}>{l.titleAr}</option>
              ))}
            </select>
          </div>
          {customerInstructions.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-3 text-center">لا توجد تعليمات بعد — أضف من المكتبة أعلاه.</p>
          ) : (
            <ul className="space-y-2">
              {customerInstructions.map((ins) => (
                <li key={ins.id} className="bg-white border border-gray-100 rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Field label="المفتاح">
                      <input value={ins.key} onChange={(e) => updateInstruction(ins.id, { key: e.target.value.trim() })} className="w-full h-9 px-2 rounded-lg border border-gray-200 text-xs lat" dir="ltr" />
                    </Field>
                    <Field label="الأيقونة">
                      <input value={ins.icon} onChange={(e) => updateInstruction(ins.id, { icon: e.target.value })} className="w-full h-9 px-2 rounded-lg border border-gray-200 text-xs lat" dir="ltr" />
                    </Field>
                    <Field label="الأولوية">
                      <input type="number" value={ins.priority} onChange={(e) => updateInstruction(ins.id, { priority: Number(e.target.value) })} className="w-full h-9 px-2 rounded-lg border border-gray-200 text-xs" />
                    </Field>
                  </div>
                  <Field label="العنوان">
                    <input value={ins.titleAr} onChange={(e) => updateInstruction(ins.id, { titleAr: e.target.value })} className="w-full h-9 px-2 rounded-lg border border-gray-200 text-xs" />
                  </Field>
                  <Field label="المحتوى">
                    <textarea value={ins.bodyAr} onChange={(e) => updateInstruction(ins.id, { bodyAr: e.target.value })} rows={2} className="w-full p-2 rounded-lg border border-gray-200 text-xs resize-none" />
                  </Field>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-[#164E63]">
                      <input type="checkbox" checked={ins.isActive} onChange={(e) => updateInstruction(ins.id, { isActive: e.target.checked })} className="w-4 h-4" />
                      نشطة
                    </label>
                    <button onClick={() => removeInstruction(ins.id)} aria-label="حذف" className="text-[10px] px-2 py-1 rounded-md bg-red-50 text-red-600 cursor-pointer">حذف</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Nurse tools — structured (aggregated into morning checklist) */}
        <section className="bg-gray-50/40 rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-xs font-bold text-[#164E63]">أدوات الممرض</h4>
              <p className="text-[11px] text-gray-500">الكميات تُجمَع تلقائياً مع أدوات بقية الطلبات في قائمة التحضير الصباحية للممرض.</p>
            </div>
            <select
              value=""
              onChange={(e) => { if (e.target.value) addToolFromLibrary(e.target.value); }}
              className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
              aria-label="إضافة من مكتبة الأدوات"
            >
              <option value="">+ إضافة من المكتبة</option>
              {libraryTools.filter((l) => l.isActive && !nurseTools.some((t) => t.toolId === l.id)).map((l) => (
                <option key={l.id} value={l.id}>{l.nameAr}</option>
              ))}
            </select>
          </div>
          {nurseTools.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-3 text-center">لا توجد أدوات مرتبطة — أضف من المكتبة أعلاه.</p>
          ) : (
            <ul className="space-y-1.5">
              {nurseTools.map((req) => {
                const lib = libraryTools.find((l) => l.id === req.toolId);
                return (
                  <li key={req.toolId} className="bg-white border border-gray-100 rounded-lg p-3 grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-12 md:col-span-4">
                      <p className="text-xs font-semibold text-[#164E63]">{lib?.nameAr ?? req.toolId}</p>
                      <p className="text-[10px] text-gray-400">{lib?.unit}</p>
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      <Field label="الكمية">
                        <input type="number" min={1} value={req.quantityPerTest} onChange={(e) => updateTool(req.toolId, { quantityPerTest: Math.max(1, Number(e.target.value)) })} className="w-full h-9 px-2 rounded-lg border border-gray-200 text-xs" />
                      </Field>
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      <label className="flex items-center gap-2 text-xs text-[#164E63] mt-4">
                        <input type="checkbox" checked={req.required} onChange={(e) => updateTool(req.toolId, { required: e.target.checked })} className="w-4 h-4" />
                        مطلوبة
                      </label>
                    </div>
                    <div className="col-span-10 md:col-span-3">
                      <Field label="ملاحظة">
                        <input value={req.note ?? ""} onChange={(e) => updateTool(req.toolId, { note: e.target.value || undefined })} className="w-full h-9 px-2 rounded-lg border border-gray-200 text-xs" />
                      </Field>
                    </div>
                    <div className="col-span-2 md:col-span-1 text-end mt-4">
                      <button onClick={() => removeTool(req.toolId)} aria-label="حذف" className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer mx-auto">
                        <Trash2 size={13} className="text-red-400" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="flex items-center justify-between mt-4">
        <Toggle checked={draft.isActive} onChange={(v) => set("isActive", v)} label="حالة النشاط" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" disabled={!draft.nameAr.trim() || draft.sellPrice <= 0} onClick={() => onSubmit(draft)}>حفظ</Button>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════ Packages CRUD ═════════════════════════════════

function PackagesAdmin({ packages, setPackages, tests }: { packages: Package[]; setPackages: React.Dispatch<React.SetStateAction<Package[]>>; tests: Test[] }) {
  const me = useCurrentAdmin();
  const session = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<Package | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Package | null>(null);

  const upsert = async (p: Package) => {
    if (!session) { toast.error("الجلسة غير صالحة"); return; }
    const exists = packages.find((x) => x.id === p.id);
    const r = await apiUpsertPackage(p);
    if (!r.ok || !r.pkg) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    const canonical = r.pkg;
    setPackages((prev) => exists ? prev.map((x) => x.id === p.id ? canonical : x) : [...prev.filter((x) => x.id !== canonical.id), canonical]);
    logActivity({ adminId: me.id, adminName: me.name, role: me.role, action: "package_edit", entity: "package", entityId: canonical.id, details: exists ? `تعديل ${canonical.nameAr}` : `إضافة ${canonical.nameAr}` });
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{packages.length} باقة</p>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> إضافة باقة</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {packages.map((pkg) => (
          <article key={pkg.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="aspect-[16/9] bg-gray-100 relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pkg.mainImage} alt={pkg.nameAr} className="w-full h-full object-cover" />
              {pkg.badgeAr && (
                <span className="absolute top-3 start-3 bg-[#059669] text-white text-[11px] font-semibold px-2 py-1 rounded-full">{pkg.badgeAr}</span>
              )}
            </div>
            <div className="p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[#164E63]">{pkg.nameAr}</h3>
                  <p className="text-[11px] text-gray-400 lat" dir="ltr">{pkg.nameEn}</p>
                </div>
                <span className="text-sm font-bold text-[#164E63]">{formatPrice(pkg.price)}</span>
              </div>
              <p className="text-xs text-gray-500 line-clamp-2">{pkg.descriptionAr}</p>
              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                <div className="flex items-center gap-1">
                  {pkg.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">موقوف</Pill>}
                  {pkg.showInSlider && <Pill color="cyan">سلايدر</Pill>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEditing(pkg)} aria-label="تعديل" className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center cursor-pointer">
                    <Pencil size={13} className="text-gray-500" aria-hidden="true" />
                  </button>
                  <button onClick={() => setConfirmDelete(pkg)} aria-label="حذف" className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer">
                    <Trash2 size={13} className="text-red-400" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      {(editing || creating) && (
        <PackageForm initial={editing ?? undefined} tests={tests} onCancel={() => { setEditing(null); setCreating(false); }} onSubmit={upsert} />
      )}
      {confirmDelete && (
        <ConfirmModal title="حذف الباقة" message={`هل تريد حذف "${confirmDelete.nameAr}"؟`} danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            if (!session) { toast.error("الجلسة غير صالحة"); return; }
            const r = await apiDeletePackage(confirmDelete.id);
            if (!r.ok) { toast.error(r.error ?? "تعذر الحذف"); return; }
            setPackages((prev) => prev.filter((x) => x.id !== confirmDelete.id));
            logActivity({ adminId: me.id, adminName: me.name, role: me.role, action: "package_edit", entity: "package", entityId: confirmDelete.id, details: `حذف ${confirmDelete.nameAr}` });
            toast.success("تم الحذف");
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function PackageForm({ initial, tests, onCancel, onSubmit }: { initial?: Package; tests: Test[]; onCancel: () => void; onSubmit: (p: Package) => void }) {
  const [draft, setDraft] = useState<Package>(() => initial ?? {
    id: `pkg-${Date.now()}`, nameAr: "", nameEn: "", descriptionAr: "", fullDescriptionAr: "",
    category: "checkup", tests: [], price: 0, originalPrice: 0,
    mainImage: "", mobileImage: "", desktopImage: "",
    displayOrder: 99, showInSlider: false, isActive: true,
  });
  const set = <K extends keyof Package>(k: K, v: Package[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const toggleTest = (t: Test) => set("tests", draft.tests.find((x) => x.id === t.id) ? draft.tests.filter((x) => x.id !== t.id) : [...draft.tests, t]);

  return (
    <Modal title={initial ? "تعديل باقة" : "إضافة باقة"} onClose={onCancel} size="xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <Field label="الاسم العربي *"><TextInput value={draft.nameAr} onChange={(e) => set("nameAr", e.target.value)} /></Field>
          <Field label="الاسم الإنجليزي"><TextInput value={draft.nameEn} onChange={(e) => set("nameEn", e.target.value)} style={{ direction: "ltr", textAlign: "right" }} /></Field>
          <Field label="وصف قصير">
            <textarea value={draft.descriptionAr} onChange={(e) => set("descriptionAr", e.target.value)} rows={2} className="w-full p-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none resize-none" />
          </Field>
          <Field label="وصف كامل">
            <textarea value={draft.fullDescriptionAr} onChange={(e) => set("fullDescriptionAr", e.target.value)} rows={3} className="w-full p-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="السعر *"><TextInput type="number" value={draft.price} onChange={(e) => set("price", Number(e.target.value))} /></Field>
            <Field label="السعر الأصلي"><TextInput type="number" value={draft.originalPrice} onChange={(e) => set("originalPrice", Number(e.target.value))} /></Field>
          </div>
          <Field label="الفئة">
            <select value={draft.category} onChange={(e) => set("category", e.target.value as Package["category"])} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
              <option value="checkup">فحص شامل</option>
              <option value="athletes">رياضيين</option>
              <option value="slimming">تنحيف</option>
              <option value="vitamins">فيتامينات</option>
            </select>
          </Field>
          <Field label="شارة (اختيارية)"><TextInput value={draft.badgeAr ?? ""} onChange={(e) => set("badgeAr", e.target.value || undefined)} placeholder="الأكثر طلباً" /></Field>
        </div>

        <div className="space-y-3">
          <MediaPicker label="الصورة الأساسية" value={draft.mainImage} onChange={(url) => set("mainImage", url)} />
          <MediaPicker label="صورة الموبايل" value={draft.mobileImage} onChange={(url) => set("mobileImage", url)} />
          <MediaPicker label="صورة الديسكتوب" value={draft.desktopImage} onChange={(url) => set("desktopImage", url)} />
          <Field label="ترتيب العرض"><TextInput type="number" value={draft.displayOrder} onChange={(e) => set("displayOrder", Number(e.target.value))} /></Field>
          <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3">
            <span className="text-sm text-[#164E63]">إظهار في السلايدر الرئيسي</span>
            <Toggle checked={draft.showInSlider} onChange={(v) => set("showInSlider", v)} label="إظهار في السلايدر" />
          </div>
          <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3">
            <span className="text-sm text-[#164E63]">نشطة</span>
            <Toggle checked={draft.isActive} onChange={(v) => set("isActive", v)} label="نشطة" />
          </div>
        </div>

        <div className="lg:col-span-2">
          <p className="text-xs font-medium text-gray-500 mb-2">التحاليل المضمّنة ({draft.tests.length})</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto border border-gray-100 rounded-xl p-2">
            {tests.map((t) => {
              const sel = !!draft.tests.find((x) => x.id === t.id);
              return (
                <button key={t.id} onClick={() => toggleTest(t)} aria-pressed={sel}
                  className={`text-start px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${sel ? "bg-[#ECFEFF] text-[#0891B2] font-semibold" : "text-gray-600 hover:bg-gray-50"}`}>
                  {t.nameAr}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2 flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" disabled={!draft.nameAr.trim() || draft.price <= 0} onClick={() => onSubmit(draft)}>حفظ الباقة</Button>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════ Coupons CRUD ══════════════════════════════════

function CouponsAdmin({ coupons, setCoupons }: { coupons: Coupon[]; setCoupons: React.Dispatch<React.SetStateAction<Coupon[]>> }) {
  const me = useCurrentAdmin();
  const session = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Coupon | null>(null);

  const upsert = async (c: Coupon) => {
    if (!session) { toast.error("الجلسة غير صالحة"); return; }
    const exists = coupons.find((x) => x.id === c.id);
    const r = await apiUpsertCoupon(c);
    if (!r.ok || !r.coupon) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    const canonical = r.coupon;
    setCoupons((prev) => exists ? prev.map((x) => x.id === c.id ? canonical : x) : [...prev.filter((x) => x.id !== canonical.id), canonical]);
    logActivity({ adminId: me.id, adminName: me.name, role: me.role, action: "coupon_change", entity: "coupon", entityId: canonical.id, details: exists ? `تعديل ${canonical.code}` : `إضافة ${canonical.code}` });
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{coupons.length} كوبون</p>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> إضافة كوبون</Button>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <DataTable
          rows={coupons}
          empty="لا توجد كوبونات"
          columns={[
            { key: "code",  label: "الكود",     render: (c) => <span className="lat font-bold" dir="ltr">{c.code}</span> },
            { key: "type",  label: "النوع",     render: (c) => c.type === "percentage" ? "نسبة" : "ثابت" },
            { key: "value", label: "القيمة",    render: (c) => c.type === "percentage" ? `${c.value}%` : formatPrice(c.value) },
            { key: "min",   label: "حد أدنى",   render: (c) => formatPrice(c.minOrderAmount) },
            { key: "exp",   label: "ينتهي",    render: (c) => <span className="text-xs text-gray-500">{c.expiryDate}</span> },
            { key: "used",  label: "الاستخدام", render: (c) => `${c.usedCount}/${c.usageLimit}` },
            { key: "active",label: "حالة",      render: (c) => c.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">موقوف</Pill> },
            { key: "act",   label: "إجراءات",   render: (c) => (
              <ActionMenu row={c} isActive={c.isActive}
                onEdit={(r) => setEditing(r)}
                onDelete={(r) => setConfirmDelete(r)}
                onToggle={async (r) => {
                  if (!session) { toast.error("الجلسة غير صالحة"); return; }
                  const next = { ...r, isActive: !r.isActive };
                  const res = await apiUpsertCoupon(next);
                  if (!res.ok) { toast.error(res.error ?? "تعذر التحديث"); return; }
                  setCoupons((prev) => prev.map((x) => x.id === r.id ? next : x));
                }}
              />
            )},
          ]}
        />
      </div>

      {(editing || creating) && <CouponForm initial={editing ?? undefined} onCancel={() => { setEditing(null); setCreating(false); }} onSubmit={upsert} />}
      {confirmDelete && (
        <ConfirmModal title="حذف الكوبون" message={`هل تريد حذف "${confirmDelete.code}"؟`} danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            if (!session) { toast.error("الجلسة غير صالحة"); return; }
            const r = await apiDeleteCoupon(confirmDelete.id);
            if (!r.ok) { toast.error(r.error ?? "تعذر الحذف"); return; }
            setCoupons((prev) => prev.filter((x) => x.id !== confirmDelete.id));
            toast.success("تم الحذف");
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function CouponForm({ initial, onCancel, onSubmit }: { initial?: Coupon; onCancel: () => void; onSubmit: (c: Coupon) => void }) {
  const [draft, setDraft] = useState<Coupon>(() => initial ?? {
    id: `c-${Date.now()}`, code: "", type: "percentage", value: 10,
    minOrderAmount: 0, maxDiscount: 100, usageLimit: 1000, usedCount: 0,
    startDate: new Date().toISOString().split("T")[0],
    expiryDate: new Date(Date.now() + 86400000 * 90).toISOString().split("T")[0],
    isActive: true,
  });
  const set = <K extends keyof Coupon>(k: K, v: Coupon[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <Modal title={initial ? "تعديل كوبون" : "إضافة كوبون"} onClose={onCancel} size="lg">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="الكود *"><TextInput value={draft.code} onChange={(e) => set("code", e.target.value.toUpperCase())} style={{ direction: "ltr", textAlign: "right" }} /></Field>
        <Field label="النوع">
          <select value={draft.type} onChange={(e) => set("type", e.target.value as Coupon["type"])} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
            <option value="percentage">نسبة %</option>
            <option value="fixed">مبلغ ثابت</option>
          </select>
        </Field>
        <Field label="القيمة *"><TextInput type="number" value={draft.value} onChange={(e) => set("value", Number(e.target.value))} /></Field>
        <Field label="الحد الأقصى للخصم"><TextInput type="number" value={draft.maxDiscount} onChange={(e) => set("maxDiscount", Number(e.target.value))} /></Field>
        <Field label="الحد الأدنى للطلب"><TextInput type="number" value={draft.minOrderAmount} onChange={(e) => set("minOrderAmount", Number(e.target.value))} /></Field>
        <Field label="حد الاستخدام"><TextInput type="number" value={draft.usageLimit} onChange={(e) => set("usageLimit", Number(e.target.value))} /></Field>
        <Field label="تاريخ البدء"><TextInput type="date" value={draft.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
        <Field label="تاريخ الانتهاء"><TextInput type="date" value={draft.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} /></Field>
      </div>
      <div className="flex items-center justify-between mt-4">
        <Toggle checked={draft.isActive} onChange={(v) => set("isActive", v)} label="حالة" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" disabled={!draft.code.trim() || draft.value <= 0} onClick={() => onSubmit(draft)}>حفظ</Button>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════ Nurses CRUD ═══════════════════════════════════

function NursesAdmin({ nurses, setNurses }: { nurses: Nurse[]; setNurses: React.Dispatch<React.SetStateAction<Nurse[]>> }) {
  const me = useCurrentAdmin();
  const toast = useToast();
  const [editing, setEditing] = useState<Nurse | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Nurse | null>(null);

  // The operational nurse profile lives on `nurses` + the linked `profiles`
  // row. Creation goes through the user-creation flow ("الموظفون") because
  // it needs an auth.users row. Here we only edit existing operational rows.
  const upsert = async (n: Nurse) => {
    const exists = nurses.find((x) => x.id === n.id);
    if (!exists) {
      toast.error("لإضافة ممرض جديد استخدم قسم الموظفون → حسابات الممرضين");
      return;
    }
    const r = await apiPatchNurse(n.id, {
      fullName: n.name, phone: n.phone, city: n.city,
      isActive: n.isActive, photoUrl: n.photoUrl,
    });
    if (!r.ok) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    setNurses((prev) => prev.map((x) => x.id === n.id ? n : x));
    logActivity({ adminId: me.id, adminName: me.name, role: me.role, action: "user_edit", entity: "nurse", entityId: n.id, details: `تعديل الممرض ${n.name}` });
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{nurses.length} ممرض</p>
        <p className="text-[11px] text-gray-400">لإضافة ممرض جديد: قسم &quot;الموظفون&quot; ← حسابات الممرضين</p>
      </div>
      <Section title="القائمة">
        <DataTable
          rows={nurses}
          columns={[
            { key: "name",   label: "الاسم",   render: (n) => n.name },
            { key: "phone",  label: "الهاتف",  render: (n) => <span className="lat" dir="ltr">{n.phone}</span> },
            { key: "city",   label: "المدينة", render: (n) => n.city },
            { key: "active", label: "الحالة",  render: (n) => n.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">غير نشط</Pill> },
            { key: "act",    label: "إجراءات", render: (n) => (
              <ActionMenu row={n} isActive={n.isActive}
                onEdit={(r) => setEditing(r)}
                onDelete={(r) => setConfirmDelete(r)}
                onToggle={async (r) => {
                  const next = !r.isActive;
                  const res = await apiPatchNurse(r.id, { isActive: next });
                  if (!res.ok) { toast.error(res.error ?? "تعذر التحديث"); return; }
                  setNurses((prev) => prev.map((x) => x.id === r.id ? { ...x, isActive: next } : x));
                }}
              />
            )},
          ]}
        />
      </Section>
      {(editing || creating) && <NurseForm initial={editing ?? undefined} onCancel={() => { setEditing(null); setCreating(false); }} onSubmit={upsert} />}
      {confirmDelete && (
        <ConfirmModal title="حذف الممرّض" message={`حذف "${confirmDelete.name}"؟`} danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { setNurses((prev) => prev.filter((x) => x.id !== confirmDelete.id)); toast.success("تم الحذف"); setConfirmDelete(null); }}
        />
      )}
    </div>
  );
}

function NurseForm({ initial, onCancel, onSubmit }: { initial?: Nurse; onCancel: () => void; onSubmit: (n: Nurse) => void }) {
  const [draft, setDraft] = useState<Nurse>(() => initial ?? {
    id: `nur-${Date.now()}`, name: "", phone: "", city: "دمشق", isActive: true,
  });
  const set = <K extends keyof Nurse>(k: K, v: Nurse[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <Modal title={initial ? "تعديل ممرّض" : "إضافة ممرّض"} onClose={onCancel}>
      <div className="space-y-3">
        <Field label="الاسم *"><TextInput value={draft.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="الهاتف *"><TextInput type="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="المدينة"><TextInput value={draft.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <MediaPicker label="صورة الممرض" value={draft.photoUrl ?? ""} onChange={(url) => set("photoUrl", url || undefined)} compact />
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#164E63]">نشط</span>
          <Toggle checked={draft.isActive} onChange={(v) => set("isActive", v)} label="نشط" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" disabled={!draft.name.trim() || !draft.phone.trim()} onClick={() => onSubmit(draft)}>حفظ</Button>
      </div>
    </Modal>
  );
}

// ════════════════════════════ Scheduling ════════════════════════════════════

function SchedulingAdmin({ nurses, routes, setRoutes, orders }: {
  nurses: Nurse[]; routes: NurseRoute[]; setRoutes: React.Dispatch<React.SetStateAction<NurseRoute[]>>; orders: Order[];
}) {
  const [nurseId, setNurseId] = useState(nurses[0]?.id ?? "");
  const [date, setDate] = useState(routes[0]?.date ?? new Date().toISOString().split("T")[0]);
  const [cityFilter, setCityFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const route = routes.find((r) => r.nurseId === nurseId && r.date === date);

  const move = (idx: number, dir: -1 | 1) => {
    if (!route) return;
    const stops = [...route.stops];
    const target = idx + dir;
    if (target < 0 || target >= stops.length) return;
    [stops[idx], stops[target]] = [stops[target], stops[idx]];
    stops.forEach((s, i) => { s.sequence = i + 1; });
    setRoutes((prev) => prev.map((r) => r === route ? { ...r, stops } : r));
  };

  const unassignedOrders = orders.filter((o) => {
    if (!["confirmed", "scheduled", "nurse_assigned"].includes(o.status)) return false;
    if (cityFilter !== "all" && o.address.city !== cityFilter) return false;
    if (shiftFilter !== "all" && o.shift !== shiftFilter) return false;
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    return !routes.some((r) => r.nurseId === nurseId && r.date === date && r.stops.some((s) => s.orderId === o.id));
  });

  const assign = (order: Order) => {
    setRoutes((prev) => {
      const existing = prev.find((r) => r.nurseId === nurseId && r.date === date);
      if (existing) {
        return prev.map((r) => r === existing ? { ...r, stops: [...r.stops, { orderId: order.id, order, sequence: r.stops.length + 1, status: "pending" as const }] } : r);
      }
      return [...prev, { nurseId, date, stops: [{ orderId: order.id, order, sequence: 1, status: "pending" as const }] }];
    });
  };

  const unassign = (orderId: string) => {
    if (!route) return;
    const stops = route.stops.filter((s) => s.orderId !== orderId);
    stops.forEach((s, i) => { s.sequence = i + 1; });
    setRoutes((prev) => prev.map((r) => r === route ? { ...r, stops } : r));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={nurseId} onChange={(e) => setNurseId(e.target.value)} className="h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer" aria-label="الممرض">
          {nurses.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} className="!h-10 max-w-[180px]" />
        <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
          <option value="all">كل المدن</option>
          <option value="دمشق">دمشق</option>
          <option value="ريف دمشق">ريف دمشق</option>
        </select>
        <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)} className="h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
          <option value="all">كل الفترات</option>
          <option value="morning">صباح</option>
          <option value="evening">مساء</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
          <option value="all">كل الحالات</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={`مسار اليوم (${route?.stops.length ?? 0})`}>
          {!route || route.stops.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">لا توجد زيارات مُسندة</p>
          ) : (
            <ol className="space-y-2" role="list">
              {route.stops.map((s, idx) => (
                <li key={s.orderId} className="bg-gray-50 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#0891B2] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{s.sequence}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#164E63] truncate">{s.order.patient.name}</p>
                    <p className="text-[11px] text-gray-500 truncate">{s.order.address.label} · {s.order.shift === "morning" ? "صباح" : "مساء"}</p>
                  </div>
                  <button onClick={() => move(idx, -1)} aria-label="إلى الأعلى" disabled={idx === 0} className="w-7 h-7 rounded-md hover:bg-white flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronUp size={14} aria-hidden="true" />
                  </button>
                  <button onClick={() => move(idx, 1)} aria-label="إلى الأسفل" disabled={idx === route.stops.length - 1} className="w-7 h-7 rounded-md hover:bg-white flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  <button onClick={() => unassign(s.orderId)} aria-label="إزالة من المسار" className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer">
                    <X size={13} className="text-red-400" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title={`طلبات قابلة للإسناد (${unassignedOrders.length})`}>
          {unassignedOrders.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">لا توجد طلبات تطابق الفلتر</p>
          ) : (
            <ul className="space-y-2" role="list">
              {unassignedOrders.map((o) => (
                <li key={o.id} className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-3">
                  <MapPin size={14} className="text-[#0891B2] flex-shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#164E63] truncate">{o.patient.name}</p>
                    <p className="text-[11px] text-gray-500 truncate">{o.address.label} · {o.address.city}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => assign(o)}><Plus size={13} aria-hidden="true" /> إضافة</Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

// ════════════════════════════ Gamification ══════════════════════════════════

function GamificationAdmin({ nurses, config, setConfig }: {
  nurses: Nurse[];
  config: typeof GAMIFICATION_CONFIG;
  setConfig: React.Dispatch<React.SetStateAction<typeof GAMIFICATION_CONFIG>>;
}) {
  const [adjustOpen, setAdjustOpen] = useState<Nurse | null>(null);
  const [adjustment, setAdjustment] = useState(0);

  const leaderboard = nurses
    .map((n) => ({ nurse: n, game: MOCK_GAMIFICATION[n.id] }))
    .filter((x) => x.game)
    .sort((a, b) => b.game.totalPoints - a.game.totalPoints);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="إعدادات النقاط">
          <div className="space-y-3">
            <Field label="نقاط لكل زيارة مكتملة">
              <TextInput type="number" value={config.pointPerCompletion} onChange={(e) => setConfig({ ...config, pointPerCompletion: Number(e.target.value) })} />
            </Field>
            <Field label="نقاط لتسليم العينة للمخبر">
              <TextInput type="number" value={config.pointPerLabDelivery} onChange={(e) => setConfig({ ...config, pointPerLabDelivery: Number(e.target.value) })} />
            </Field>
            <Field label="مكافأة الاستمرارية اليومية">
              <TextInput type="number" value={config.pointStreakBonus} onChange={(e) => setConfig({ ...config, pointStreakBonus: Number(e.target.value) })} />
            </Field>
          </div>
        </Section>

        <Section title="المستويات">
          <ul className="space-y-2">
            {NURSE_LEVELS.map((lv) => (
              <li key={lv.id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-2.5">
                <span className="w-6 h-6 rounded-full" style={{ backgroundColor: lv.color }} aria-hidden="true" />
                <span className="text-sm font-semibold text-[#164E63] flex-1">{lv.name}</span>
                <span className="text-[11px] text-gray-500">من {lv.minPoints} نقطة</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="الشارات">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {NURSE_BADGES.map((b) => (
            <div key={b.id} className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">
              <Trophy size={18} className="text-amber-600 mx-auto mb-1" aria-hidden="true" />
              <p className="text-xs font-semibold text-[#164E63]">{b.name}</p>
              <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{b.description}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="ترتيب الممرضين" action={<span className="text-[11px] text-gray-400">حسب إجمالي النقاط</span>}>
        <DataTable
          rows={leaderboard}
          columns={[
            { key: "rank",     label: "#",          render: (_, ) => <span className="font-bold text-[#0891B2]">{leaderboard.indexOf(_) + 1}</span> },
            { key: "name",     label: "الاسم",       render: (x) => x.nurse.name },
            { key: "level",    label: "المستوى",     render: (x) => <Pill color="cyan">{x.game.level.name}</Pill> },
            { key: "points",   label: "النقاط",      render: (x) => <span className="font-bold">{x.game.totalPoints.toLocaleString("ar")}</span> },
            { key: "done",     label: "زيارات",      render: (x) => x.game.totalCompleted },
            { key: "rate",     label: "نسبة النجاح", render: (x) => `${x.game.successRate}%` },
            { key: "act",      label: "إجراءات",     render: (x) => (
              <button onClick={() => { setAdjustment(0); setAdjustOpen(x.nurse); }} className="text-xs px-2 py-1 rounded-md bg-[#ECFEFF] text-[#0891B2] cursor-pointer">تعديل نقاط</button>
            )},
          ]}
        />
      </Section>

      {adjustOpen && (
        <Modal title={`تعديل نقاط — ${adjustOpen.name}`} onClose={() => setAdjustOpen(null)}>
          <Field label="القيمة (موجبة لإضافة، سالبة للخصم)">
            <TextInput type="number" value={adjustment} onChange={(e) => setAdjustment(Number(e.target.value))} />
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setAdjustOpen(null)}>إلغاء</Button>
            <Button variant="primary" onClick={() => {
              const game = MOCK_GAMIFICATION[adjustOpen.id];
              if (game) game.totalPoints = Math.max(0, game.totalPoints + adjustment);
              setAdjustOpen(null);
            }}>تطبيق</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ════════════════════════════ Invoices + Payments ═══════════════════════════

function InvoicesAdmin() {
  const [invoices, setInvoices] = useState<Invoice[]>(MOCK_INVOICES);
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "all">("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Invoice | null>(null);

  const statuses: { v: PaymentStatus | "all"; label: string }[] = [
    { v: "all",       label: "الكل" },
    { v: "pending",   label: "بانتظار الدفع" },
    { v: "paid",      label: "مدفوعة" },
    { v: "refunded",  label: "مستردّة" },
    { v: "cancelled", label: "ملغاة" },
  ];

  const filtered = invoices.filter((inv) => {
    if (statusFilter !== "all" && inv.paymentStatus !== statusFilter) return false;
    if (methodFilter !== "all" && inv.paymentMethod !== methodFilter) return false;
    if (search && !inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) && !inv.patientName.includes(search)) return false;
    return true;
  });

  const updateStatus = (inv: Invoice, status: PaymentStatus) => {
    setInvoices((p) => p.map((x) => x.id === inv.id ? { ...x, paymentStatus: status } : x));
    setOpen({ ...inv, paymentStatus: status });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
          <TextInput placeholder="بحث برقم الفاتورة أو المريض" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="ps-9" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as PaymentStatus | "all"); setPage(1); }} className="h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
          {statuses.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <select value={methodFilter} onChange={(e) => { setMethodFilter(e.target.value); setPage(1); }} className="h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
          <option value="all">كل طرق الدفع</option>
          <option value="cash">نقداً</option>
          <option value="online">إلكتروني</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <DataTable
          rows={filtered}
          page={page} pageSize={10} onPage={setPage}
          empty="لا توجد فواتير"
          columns={[
            { key: "n",       label: "رقم الفاتورة", render: (i) => <span className="lat font-semibold" dir="ltr">{i.invoiceNumber}</span> },
            { key: "p",       label: "المريض",       render: (i) => i.patientName },
            { key: "method",  label: "الدفع",        render: (i) => i.paymentMethod === "cash" ? "نقداً" : "إلكتروني" },
            { key: "status",  label: "الحالة",       render: (i) => <Pill color={i.paymentStatus === "paid" ? "green" : i.paymentStatus === "pending" ? "amber" : i.paymentStatus === "cancelled" ? "red" : "purple"}>{statuses.find((s) => s.v === i.paymentStatus)?.label}</Pill> },
            { key: "date",    label: "التاريخ",      render: (i) => <span className="text-xs text-gray-500">{formatDate(i.issuedAt)}</span> },
            { key: "total",   label: "المجموع",      render: (i) => <span className="font-bold">{formatPrice(i.total)}</span> },
            { key: "actions", label: "إجراءات",      render: (i) => (
              <button onClick={() => setOpen(i)} className="text-xs px-2 py-1 rounded-md bg-[#ECFEFF] text-[#0891B2] cursor-pointer flex items-center gap-1">
                <Eye size={12} aria-hidden="true" /> عرض
              </button>
            )},
          ]}
        />
      </div>

      {open && <InvoiceView invoice={open} onClose={() => setOpen(null)} onStatusChange={(s) => updateStatus(open, s)} />}
    </div>
  );
}

function PaymentsAdmin() {
  const paid = MOCK_INVOICES.filter((i) => i.paymentStatus === "paid");
  const pending = MOCK_INVOICES.filter((i) => i.paymentStatus === "pending");
  const total = paid.reduce((s, i) => s + i.total, 0);
  const pendingTotal = pending.reduce((s, i) => s + i.total, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<CheckCircle size={20} />} label="مدفوعة (ل.س)" value={total.toLocaleString("ar")} color="bg-emerald-600 text-white" />
        <StatCard icon={<Clock size={20} />} label="بانتظار الدفع" value={pendingTotal.toLocaleString("ar")} color="bg-amber-500 text-white" />
        <StatCard icon={<CreditCard size={20} />} label="إلكتروني" value={MOCK_INVOICES.filter((i) => i.paymentMethod === "online").length} color="bg-[#0891B2] text-white" />
        <StatCard icon={<DollarSign size={20} />} label="نقداً" value={MOCK_INVOICES.filter((i) => i.paymentMethod === "cash").length} color="bg-purple-600 text-white" />
      </div>
      <Section title="حركة المدفوعات">
        <DataTable
          rows={MOCK_INVOICES}
          columns={[
            { key: "n",       label: "الفاتورة",  render: (i) => <span className="lat" dir="ltr">{i.invoiceNumber}</span> },
            { key: "patient", label: "المريض",    render: (i) => i.patientName },
            { key: "method",  label: "الطريقة",   render: (i) => i.paymentMethod === "cash" ? "نقداً" : "إلكتروني" },
            { key: "status",  label: "الحالة",    render: (i) => <Pill color={i.paymentStatus === "paid" ? "green" : "amber"}>{i.paymentStatus === "paid" ? "مدفوع" : "معلّق"}</Pill> },
            { key: "total",   label: "المبلغ",    render: (i) => <span className="font-bold">{formatPrice(i.total)}</span> },
          ]}
        />
      </Section>
    </div>
  );
}

// ════════════════════════════ Sliders / Icons / Notifications ═══════════════

function SlidersAdmin({ sliders, setSliders, packages }: { sliders: SliderItem[]; setSliders: React.Dispatch<React.SetStateAction<SliderItem[]>>; packages: Package[] }) {
  const me = useCurrentAdmin();
  const session = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<SliderItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SliderItem | null>(null);

  const upsert = async (s: SliderItem) => {
    if (!session) { toast.error("الجلسة غير صالحة"); return; }
    const exists = sliders.find((x) => x.id === s.id);
    const r = await apiUpsertSlider(s);
    if (!r.ok || !r.slider) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    const canonical = r.slider;
    setSliders((prev) => exists ? prev.map((x) => x.id === s.id ? canonical : x) : [...prev.filter((x) => x.id !== canonical.id), canonical]);
    logActivity({ adminId: me.id, adminName: me.name, role: me.role, action: "slider_edit", entity: "slider", entityId: canonical.id, details: exists ? `تعديل ${canonical.titleAr}` : `إضافة ${canonical.titleAr}` });
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{sliders.length} عنصر</p>
        <div className="flex items-center gap-2">
          {sliders.length === 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const res = await fetch("/api/admin/sliders/seed-defaults", { method: "POST" });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) { toast.error(body.error ?? "تعذر إنشاء السلايدرات الافتراضية"); return; }
                const remote = await hydrateAdminSliders();
                if (remote) setSliders(remote);
                toast.success("تم إنشاء السلايدرات الافتراضية");
              }}
            >
              إنشاء سلايدرات افتراضية
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> إضافة سلايدر</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sliders.sort((a, b) => a.displayOrder - b.displayOrder).map((s) => (
          <article key={s.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="aspect-[16/9] bg-gray-100 relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.desktopImage} alt={s.titleAr} className="w-full h-full object-cover" />
              <span className="absolute top-2 start-2 bg-black/60 text-white text-[11px] px-2 py-0.5 rounded-md">#{s.displayOrder}</span>
            </div>
            <div className="p-4 space-y-2">
              <h3 className="text-sm font-bold text-[#164E63]">{s.titleAr}</h3>
              <p className="text-xs text-gray-500 line-clamp-2">{s.subtitleAr}</p>
              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                <Pill color={s.isActive ? "green" : "red"}>{s.isActive ? "نشط" : "موقوف"}</Pill>
                <ActionMenu row={s} isActive={s.isActive}
                  onEdit={(r) => setEditing(r)}
                  onDelete={(r) => setConfirmDelete(r)}
                  onToggle={async (r) => {
                    if (!session) { toast.error("الجلسة غير صالحة"); return; }
                    const next = { ...r, isActive: !r.isActive };
                    const res = await apiUpsertSlider(next);
                    if (!res.ok) { toast.error(res.error ?? "تعذر التحديث"); return; }
                    setSliders((prev) => prev.map((x) => x.id === r.id ? next : x));
                  }}
                />
              </div>
            </div>
          </article>
        ))}
      </div>
      {(editing || creating) && <SliderForm initial={editing ?? undefined} packages={packages} onCancel={() => { setEditing(null); setCreating(false); }} onSubmit={upsert} />}
      {confirmDelete && (
        <ConfirmModal title="حذف السلايدر" message={`حذف "${confirmDelete.titleAr}"؟`} danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            if (!session) { toast.error("الجلسة غير صالحة"); return; }
            const r = await apiDeleteSlider(confirmDelete.id);
            if (!r.ok) { toast.error(r.error ?? "تعذر الحذف"); return; }
            setSliders((prev) => prev.filter((x) => x.id !== confirmDelete.id));
            toast.success("تم الحذف");
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function SliderForm({ initial, packages, onCancel, onSubmit }: { initial?: SliderItem; packages: Package[]; onCancel: () => void; onSubmit: (s: SliderItem) => void }) {
  // New rows start with an empty id; the server returns the canonical UUID
  // on save. We only forward `id` to the API when it's already a UUID.
  const [draft, setDraft] = useState<SliderItem>(() => initial ?? {
    id: "", titleAr: "", subtitleAr: "",
    mobileImage: "", desktopImage: "", priceLabel: "", ctaLabel: "احجز الآن",
    ctaTarget: "package", displayOrder: 99, isActive: true,
  });
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof SliderItem>(k: K, v: SliderItem[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const handleSubmit = () => {
    setError(null);
    if (!draft.titleAr.trim()) { setError("العنوان مطلوب"); return; }
    if (draft.ctaTarget === "package") {
      if (!draft.ctaTargetId || !UUID_RE.test(draft.ctaTargetId)) {
        const msg = "اختر باقة صحيحة من القائمة";
        setError(msg);
        toast.error(msg);
        return;
      }
    } else if (draft.ctaTargetId && !UUID_RE.test(draft.ctaTargetId)) {
      // Non-package targets must not carry a stale package UUID.
      set("ctaTargetId", undefined);
    }
    onSubmit(draft);
  };

  return (
    <Modal title={initial ? "تعديل سلايدر" : "إضافة سلايدر"} onClose={onCancel} size="lg">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="العنوان *"><TextInput value={draft.titleAr} onChange={(e) => set("titleAr", e.target.value)} /></Field>
        <Field label="نص السعر"><TextInput value={draft.priceLabel} onChange={(e) => set("priceLabel", e.target.value)} /></Field>
        <Field label="الوصف القصير">
          <textarea value={draft.subtitleAr} onChange={(e) => set("subtitleAr", e.target.value)} rows={2} className="w-full p-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none resize-none md:col-span-2" />
        </Field>
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          <MediaPicker label="صورة الموبايل" value={draft.mobileImage} onChange={(url) => set("mobileImage", url)} />
          <MediaPicker label="صورة الديسكتوب" value={draft.desktopImage} onChange={(url) => set("desktopImage", url)} />
        </div>
        <Field label="نص زر CTA"><TextInput value={draft.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} /></Field>
        <Field label="هدف الـ CTA">
          <select value={draft.ctaTarget} onChange={(e) => {
            const next = e.target.value as SliderItem["ctaTarget"];
            setDraft((d) => ({ ...d, ctaTarget: next, ctaTargetId: next === "package" ? d.ctaTargetId : undefined }));
          }} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
            <option value="package">باقة محددة</option>
            <option value="custom-builder">صفحة اختيار التحاليل</option>
            <option value="prescription">صفحة الوصفة</option>
            <option value="external">رابط خارجي</option>
          </select>
        </Field>
        {draft.ctaTarget === "package" && (
          <Field label="الباقة المرتبطة *">
            <select
              value={draft.ctaTargetId && UUID_RE.test(draft.ctaTargetId) ? draft.ctaTargetId : ""}
              onChange={(e) => set("ctaTargetId", e.target.value || undefined)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer"
            >
              <option value="">— اختر باقة —</option>
              {packages.filter((p) => UUID_RE.test(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.nameAr}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="ترتيب العرض"><TextInput type="number" value={draft.displayOrder} onChange={(e) => set("displayOrder", Number(e.target.value))} /></Field>
      </div>
      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      <div className="flex items-center justify-between mt-4">
        <Toggle checked={draft.isActive} onChange={(v) => set("isActive", v)} label="نشط" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" disabled={!draft.titleAr.trim()} onClick={handleSubmit}>حفظ</Button>
        </div>
      </div>
    </Modal>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function IconsAdmin({ icons, setIcons }: { icons: SvgIcon[]; setIcons: React.Dispatch<React.SetStateAction<SvgIcon[]>> }) {
  const me = useCurrentAdmin();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  return (
    <Section title="مكتبة الأيقونات" action={<Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> رفع أيقونة SVG</Button>}>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {icons.map((i) => (
          <div key={i.id} className="border border-gray-100 rounded-xl p-3 flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-xl bg-[#ECFEFF] flex items-center justify-center mb-2 text-[#0891B2] text-[10px] lat" dir="ltr">
              {i.svg.replace("lucide:", "")}
            </div>
            <p className="text-xs font-semibold text-[#164E63]">{i.nameAr}</p>
            <p className="text-[10px] text-gray-400 mb-2">{i.category}</p>
            <div className="flex items-center gap-1">
              <Toggle
                checked={i.isActive}
                onChange={() => {
                  setIcons((prev) => prev.map((x) => x.id === i.id ? { ...x, isActive: !x.isActive } : x));
                  logActivity({ adminId: me.id, adminName: me.name, role: me.role, action: "icon_edit", entity: "icon", entityId: i.id, details: i.isActive ? `إيقاف ${i.nameAr}` : `تفعيل ${i.nameAr}` });
                  toast.success(i.isActive ? "تم الإيقاف" : "تم التفعيل");
                }}
                label={`${i.isActive ? "إيقاف" : "تفعيل"} ${i.nameAr}`}
              />
              <button
                aria-label={`حذف ${i.nameAr}`}
                onClick={() => {
                  setIcons((prev) => prev.filter((x) => x.id !== i.id));
                  logActivity({ adminId: me.id, adminName: me.name, role: me.role, action: "icon_edit", entity: "icon", entityId: i.id, details: `حذف ${i.nameAr}` });
                  toast.success("تم الحذف");
                }}
                className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer"
              >
                <Trash2 size={12} className="text-red-400" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {creating && (
        <Modal title="رفع أيقونة" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <Field label="الاسم العربي"><TextInput placeholder="مثلاً: حقنة" /></Field>
            <Field label="الفئة">
              <select className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
                <option value="instruction">تعليمات</option>
                <option value="package">باقات</option>
                <option value="slider">سلايدر</option>
                <option value="general">عام</option>
              </select>
            </Field>
            <Field label="ملف SVG">
              <input type="file" accept=".svg" className="block w-full text-sm file:me-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#ECFEFF] file:text-[#0891B2] file:cursor-pointer" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreating(false)}>إلغاء</Button>
              <Button variant="primary" onClick={() => setCreating(false)}>رفع</Button>
            </div>
          </div>
        </Modal>
      )}
    </Section>
  );
}

function NotificationsAdmin({ notifications, setNotifications }: { notifications: Notification[]; setNotifications: React.Dispatch<React.SetStateAction<Notification[]>> }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const send = () => {
    setSending(true);
    setTimeout(() => {
      const id = `n-${Date.now()}`;
      setNotifications((p) => [{
        id, userId: "broadcast", titleAr: title, bodyAr: body,
        type: "admin_note", isRead: false, createdAt: new Date().toISOString(),
      }, ...p]);
      setTitle(""); setBody(""); setSending(false); setConfirmOpen(false);
    }, 600);
  };

  return (
    <div className="space-y-4">
      <Section title="إرسال إشعار جماعي">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="عنوان الإشعار"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عرض جديد" /></Field>
          <Field label="نص الإشعار"><TextInput value={body} onChange={(e) => setBody(e.target.value)} placeholder="..." /></Field>
        </div>
        <div className="flex justify-end mt-4">
          <Button size="md" disabled={!title.trim() || !body.trim()} loading={sending} onClick={() => setConfirmOpen(true)}>إرسال للجميع</Button>
        </div>
      </Section>
      <Section title="آخر الإشعارات">
        <DataTable
          rows={notifications}
          columns={[
            { key: "title",   label: "العنوان",  render: (n) => n.titleAr },
            { key: "body",    label: "النص",     render: (n) => <span className="text-xs text-gray-500">{n.bodyAr}</span> },
            { key: "type",    label: "النوع",    render: (n) => <Pill color="cyan">{n.type}</Pill> },
            { key: "date",    label: "التاريخ",  render: (n) => <span className="text-xs text-gray-500">{relativeTime(n.createdAt)}</span> },
          ]}
        />
      </Section>
      {confirmOpen && (
        <ConfirmModal title="تأكيد الإرسال" message={`سيُرسل الإشعار "${title}" لجميع المستخدمين النشطين.`}
          onCancel={() => setConfirmOpen(false)} onConfirm={send}
        />
      )}
    </div>
  );
}

// ════════════════════════════ Admins / Activity / Settings ══════════════════

function AdminsAdmin({ currentUser }: { currentUser: AdminUser }) {
  const toast = useToast();
  const admins = useAdmins();
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);
  const [tab, setTab] = useState<"admins" | "customers" | "nurses">("admins");

  if (currentUser.role !== "super_admin") {
    return <p className="text-sm text-gray-500">هذه الصفحة متاحة للمدير العام فقط.</p>;
  }

  const upsert = async (a: AdminUser) => {
    const exists = admins.find((x) => x.id === a.id);
    const r = await upsertAdmin(a);
    if (!r.ok) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    logActivity({ adminId: currentUser.id, adminName: currentUser.name, role: currentUser.role, action: "user_edit", entity: "admin", entityId: r.id ?? a.id, details: exists ? `تعديل الموظف ${a.name}` : `إضافة الموظف ${a.name}` });
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-gray-100">
        {[
          { id: "admins" as const, label: "موظفو لوحة الإدارة" },
          { id: "customers" as const, label: "حسابات العملاء" },
          { id: "nurses" as const, label: "حسابات الممرضين" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={tab === t.id
              ? "px-3 py-2 text-sm font-semibold text-[#0E7490] border-b-2 border-[#0891B2] cursor-pointer"
              : "px-3 py-2 text-sm font-medium text-gray-500 hover:text-[#164E63] cursor-pointer"}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "admins" && (
        <>
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{admins.length} موظف</p>
            <Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> إضافة موظف</Button>
          </div>
          <Section title="موظفو لوحة الإدارة">
            <DataTable
              rows={admins}
              columns={[
                { key: "user",   label: "اسم المستخدم", render: (a) => <span className="lat" dir="ltr">{a.username}</span> },
                { key: "name",   label: "الاسم",         render: (a) => a.name },
                { key: "role",   label: "الدور",         render: (a) => <Pill color="cyan">{ROLE_LABELS[a.role]}</Pill> },
                { key: "active", label: "حالة",          render: (a) => a.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">موقوف</Pill> },
                { key: "last",   label: "آخر دخول",      render: (a) => <span className="text-xs text-gray-500">{a.lastLogin ? relativeTime(a.lastLogin) : "—"}</span> },
                { key: "act",    label: "إجراءات",       render: (a) => (
                  <ActionMenu row={a} isActive={a.isActive}
                    onEdit={(r) => setEditing(r)}
                    onDelete={(r) => setConfirmDelete(r)}
                    onToggle={(r) => setAdminActive(r.id, !r.isActive)}
                  />
                )},
              ]}
            />
          </Section>

          <Section title="الأدوار والصلاحيات">
            <ul className="space-y-2 text-sm">
              {Object.entries(ROLE_LABELS).map(([role, label]) => (
                <li key={role} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-[#164E63]">{label}</span>
                    <span className="lat text-[11px] text-gray-400" dir="ltr">{role}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {currentUser.role === "super_admin" && role === "super_admin"
                      ? "كل الصلاحيات"
                      : (admins.filter((a) => a.role === role).length + " موظفين بهذا الدور")}
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          {(editing || creating) && <AdminForm initial={editing ?? undefined} onCancel={() => { setEditing(null); setCreating(false); }} onSubmit={upsert} />}
          {confirmDelete && (
            <ConfirmModal title="حذف الموظف" message={`حذف "${confirmDelete.name}"؟`} danger
              onCancel={() => setConfirmDelete(null)}
              onConfirm={() => { deleteAdmin(confirmDelete.id); toast.success("تم الحذف"); setConfirmDelete(null); }}
            />
          )}
        </>
      )}

      {tab === "customers" && <CustomerAccountsAdmin currentUser={currentUser} />}
      {tab === "nurses"    && <NurseAccountsAdmin    currentUser={currentUser} />}
    </div>
  );
}

function CustomerAccountsAdmin({ currentUser }: { currentUser: AdminUser }) {
  const toast = useToast();
  const users = useCustomerUsers();
  const [editing, setEditing] = useState<import("@/lib/types").AuthUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<import("@/lib/types").AuthUser | null>(null);
  const [resetTarget, setResetTarget] = useState<import("@/lib/types").AuthUser | null>(null);
  const [shareCreds, setShareCreds] = useState<ShareableCredentials | null>(null);

  return (
    <>
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{users.length} عميل</p>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> إضافة عميل</Button>
      </div>
      <Section title="حسابات العملاء">
        <DataTable
          rows={users}
          columns={[
            { key: "user", label: "اسم المستخدم", render: (u) => <span className="lat" dir="ltr">{u.username}</span> },
            { key: "name", label: "الاسم",        render: (u) => u.name },
            { key: "linked", label: "ربط",        render: (u) => <span className="lat text-[11px] text-gray-400" dir="ltr">{u.linkedEntityId}</span> },
            { key: "active", label: "حالة",       render: (u) => u.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">موقوف</Pill> },
            { key: "last", label: "آخر دخول",     render: (u) => <span className="text-xs text-gray-500">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : "—"}</span> },
            { key: "act", label: "إجراءات",       render: (u) => (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setResetTarget(u)}>إعادة تعيين كلمة المرور</Button>
                <ActionMenu row={u} isActive={u.isActive}
                  onEdit={(r) => setEditing(r)}
                  onDelete={(r) => setConfirmDelete(r)}
                  onToggle={(r) => setCustomerUserActive(r.id, !r.isActive)}
                />
              </div>
            )},
          ]}
        />
      </Section>

      {(editing || creating) && <AuthUserForm role="customer" initial={editing ?? undefined} onCancel={() => { setEditing(null); setCreating(false); }} onSubmit={async (u) => {
        const isCreate = !editing;
        const r = await upsertCustomerUser(u);
        if (!r.ok) { toast.error(r.error ?? "تعذر الحفظ"); return; }
        logActivity({ adminId: currentUser.id, adminName: currentUser.name, role: currentUser.role, action: "user_edit", entity: "customer_user", entityId: r.id ?? u.id, details: editing ? `تعديل حساب العميل ${u.name}` : `إضافة حساب عميل ${u.name}` });
        toast.success("تم الحفظ بنجاح"); setEditing(null); setCreating(false);
        if (isCreate && u.password) {
          setShareCreds({ roleLabel: "عميل", fullName: u.name, email: u.username, password: u.password, phone: u.phone });
        }
      }} />}

      {confirmDelete && (
        <ConfirmModal title="حذف الحساب" message={`حذف "${confirmDelete.name}"؟`} danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { deleteCustomerUser(confirmDelete.id); toast.success("تم الحذف"); setConfirmDelete(null); }}
        />
      )}

      {resetTarget && (
        <PasswordResetModal target={resetTarget} onCancel={() => setResetTarget(null)}
          onConfirm={(pw) => { resetCustomerUserPassword(resetTarget.id, pw); toast.success("تم إعادة تعيين كلمة المرور"); setResetTarget(null); }}
        />
      )}

      {shareCreds && (
        <CredentialsShareSheet credentials={shareCreds} onClose={() => setShareCreds(null)} />
      )}
    </>
  );
}

function NurseAccountsAdmin({ currentUser }: { currentUser: AdminUser }) {
  const toast = useToast();
  const users = useNurseUsers();
  const [editing, setEditing] = useState<import("@/lib/types").AuthUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<import("@/lib/types").AuthUser | null>(null);
  const [resetTarget, setResetTarget] = useState<import("@/lib/types").AuthUser | null>(null);
  const [shareCreds, setShareCreds] = useState<ShareableCredentials | null>(null);

  return (
    <>
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{users.length} ممرض</p>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> إضافة ممرض</Button>
      </div>
      <Section title="حسابات الممرضين">
        <DataTable
          rows={users}
          columns={[
            { key: "user", label: "اسم المستخدم", render: (u) => <span className="lat" dir="ltr">{u.username}</span> },
            { key: "name", label: "الاسم",        render: (u) => u.name },
            { key: "linked", label: "ربط", render: (u) => (
              <span className="lat text-[11px] text-gray-400" dir="ltr">{u.linkedEntityId}</span>
            ) },
            { key: "active", label: "حالة",       render: (u) => u.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">موقوف</Pill> },
            { key: "last", label: "آخر دخول",     render: (u) => <span className="text-xs text-gray-500">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : "—"}</span> },
            { key: "act", label: "إجراءات",       render: (u) => (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setResetTarget(u)}>إعادة تعيين كلمة المرور</Button>
                <ActionMenu row={u} isActive={u.isActive}
                  onEdit={(r) => setEditing(r)}
                  onDelete={(r) => setConfirmDelete(r)}
                  onToggle={(r) => setNurseUserActive(r.id, !r.isActive)}
                />
              </div>
            )},
          ]}
        />
      </Section>

      {(editing || creating) && <AuthUserForm role="nurse" initial={editing ?? undefined} onCancel={() => { setEditing(null); setCreating(false); }} onSubmit={async (u) => {
        const isCreate = !editing;
        const r = await upsertNurseUser(u);
        if (!r.ok) { toast.error(r.error ?? "تعذر الحفظ"); return; }
        logActivity({ adminId: currentUser.id, adminName: currentUser.name, role: currentUser.role, action: "user_edit", entity: "nurse_user", entityId: r.id ?? u.id, details: editing ? `تعديل حساب الممرض ${u.name}` : `إضافة حساب ممرض ${u.name}` });
        toast.success("تم الحفظ بنجاح"); setEditing(null); setCreating(false);
        if (isCreate && u.password) {
          setShareCreds({ roleLabel: "ممرض", fullName: u.name, email: u.username, password: u.password, phone: u.phone });
        }
      }} />}

      {confirmDelete && (
        <ConfirmModal title="حذف الحساب" message={`حذف "${confirmDelete.name}"؟`} danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { deleteNurseUser(confirmDelete.id); toast.success("تم الحذف"); setConfirmDelete(null); }}
        />
      )}

      {resetTarget && (
        <PasswordResetModal target={resetTarget} onCancel={() => setResetTarget(null)}
          onConfirm={(pw) => { resetNurseUserPassword(resetTarget.id, pw); toast.success("تم إعادة تعيين كلمة المرور"); setResetTarget(null); }}
        />
      )}

      {shareCreds && (
        <CredentialsShareSheet credentials={shareCreds} onClose={() => setShareCreds(null)} />
      )}
    </>
  );
}

function AuthUserForm({ role, initial, onCancel, onSubmit }: {
  role: "customer" | "nurse";
  initial?: import("@/lib/types").AuthUser;
  onCancel: () => void;
  // Returning the draft + the optional richer profile fields lets the caller
  // forward `phone` / `city` into apiCreateUser without breaking the legacy
  // AuthUser shape.
  onSubmit: (u: import("@/lib/types").AuthUser & { phone?: string; city?: string }) => void;
}) {
  // New-user drafts must NOT carry a fake slug id ("nu-…", "cu-…"). The
  // server route validates id as a UUID; passing a slug routes to PATCH and
  // the request fails with "user id must be a uuid". Empty id keeps every
  // upsert wrapper on the create path until the server returns a real UUID.
  const [draft, setDraft] = useState<import("@/lib/types").AuthUser>(() => initial ?? {
    id: "",
    username: "",
    password: "",
    name: "",
    role,
    linkedEntityId: "",
    isActive: true,
  });
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState(role === "nurse" ? "دمشق" : "");
  const set = <K extends keyof import("@/lib/types").AuthUser>(k: K, v: import("@/lib/types").AuthUser[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const generatePassword = () => set("password", generateTempPassword());

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.username.trim());
  const passwordValid = !!initial || draft.password.length >= 8;

  return (
    <Modal title={initial ? (role === "customer" ? "تعديل عميل" : "تعديل ممرض") : (role === "customer" ? "إضافة عميل" : "إضافة ممرض")} onClose={onCancel}>
      <div className="space-y-3">
        <Field label="الاسم الكامل *">
          <TextInput value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="البريد الإلكتروني *">
          <TextInput
            type="email"
            value={draft.username}
            onChange={(e) => set("username", e.target.value)}
            style={{ direction: "ltr", textAlign: "right" }}
            placeholder="user@example.com"
          />
          {draft.username && !emailValid && (
            <p className="text-[11px] text-red-500 mt-1">صيغة البريد غير صحيحة</p>
          )}
        </Field>
        <Field label="رقم الهاتف">
          <TextInput
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{ direction: "ltr", textAlign: "right" }}
            placeholder="+963 9XX XXX XXX"
          />
        </Field>
        {role === "nurse" && (
          <Field label="المدينة">
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer"
            >
              <option value="دمشق">دمشق</option>
              <option value="ريف دمشق">ريف دمشق</option>
            </select>
          </Field>
        )}
        {!initial && (
          <Field label="كلمة المرور المبدئية * (٨ أحرف على الأقل)">
            <div className="flex gap-2">
              <TextInput
                type="text"
                value={draft.password}
                onChange={(e) => set("password", e.target.value)}
                style={{ direction: "ltr", textAlign: "right" }}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={generatePassword}>توليد</Button>
            </div>
            {draft.password && !passwordValid && (
              <p className="text-[11px] text-red-500 mt-1">يجب ألا تقل عن ٨ أحرف</p>
            )}
          </Field>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#164E63]">نشط</span>
          <Toggle checked={draft.isActive} onChange={(v) => set("isActive", v)} label="نشط" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        <Button
          variant="primary"
          disabled={!draft.name.trim() || !emailValid || !passwordValid}
          onClick={() => onSubmit({ ...draft, phone: phone.trim() || undefined, city: city.trim() || undefined })}
        >حفظ</Button>
      </div>
    </Modal>
  );
}

function PasswordResetModal({ target, onCancel, onConfirm }: {
  target: import("@/lib/types").AuthUser;
  onCancel: () => void;
  onConfirm: (newPassword: string) => void;
}) {
  const [pw, setPw] = useState("");
  return (
    <Modal title={`إعادة تعيين كلمة مرور — ${target.name}`} onClose={onCancel}>
      <div className="space-y-3">
        <Field label="كلمة مرور جديدة *">
          <TextInput type="text" value={pw} onChange={(e) => setPw(e.target.value)} style={{ direction: "ltr", textAlign: "right" }} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" disabled={!pw.trim()} onClick={() => onConfirm(pw.trim())}>حفظ</Button>
      </div>
    </Modal>
  );
}

function AdminForm({ initial, onCancel, onSubmit }: { initial?: AdminUser; onCancel: () => void; onSubmit: (a: AdminUser) => void }) {
  // Empty id on new drafts so the upsert wrapper hits POST, not PATCH.
  const [draft, setDraft] = useState<AdminUser>(() => initial ?? {
    id: "", username: "", password: "", name: "", role: "customer_support", isActive: true,
  });
  const set = <K extends keyof AdminUser>(k: K, v: AdminUser[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <Modal title={initial ? "تعديل موظف" : "إضافة موظف"} onClose={onCancel}>
      <div className="space-y-3">
        <Field label="الاسم *"><TextInput value={draft.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="اسم المستخدم *"><TextInput value={draft.username} onChange={(e) => set("username", e.target.value)} style={{ direction: "ltr", textAlign: "right" }} /></Field>
        <Field label="كلمة المرور *"><TextInput type="text" value={draft.password} onChange={(e) => set("password", e.target.value)} style={{ direction: "ltr", textAlign: "right" }} /></Field>
        <Field label="الدور">
          <select value={draft.role} onChange={(e) => set("role", e.target.value as AdminRole)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
            {Object.entries(ROLE_LABELS).map(([r, l]) => <option key={r} value={r}>{l}</option>)}
          </select>
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#164E63]">نشط</span>
          <Toggle checked={draft.isActive} onChange={(v) => set("isActive", v)} label="نشط" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" disabled={!draft.username.trim() || !draft.password.trim() || !draft.name.trim()} onClick={() => onSubmit(draft)}>حفظ</Button>
      </div>
    </Modal>
  );
}

function ActivityAdmin() {
  const [actorFilter, setActorFilter] = useState<AdminRole | "all">("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const logs = useActivityLogs();
  // Stage G: pull persisted activity entries on mount.
  useEffect(() => { void hydrateActivityLogs(); }, []);

  const filtered = logs.filter((l) => {
    if (actorFilter !== "all" && l.role !== actorFilter) return false;
    if (actionFilter !== "all" && l.action !== actionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!l.adminName.toLowerCase().includes(q) && !l.details.toLowerCase().includes(q) && !l.entityId.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
          <TextInput placeholder="بحث في السجل" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="ps-9" />
        </div>
        <select value={actorFilter} onChange={(e) => { setActorFilter(e.target.value as AdminRole | "all"); setPage(1); }} className="h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
          <option value="all">كل الأدوار</option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} className="h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
          <option value="all">كل الإجراءات</option>
          {Object.entries(ACTIVITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <Section title={`السجلات (${filtered.length})`}>
        <DataTable
          rows={filtered}
          page={page} pageSize={15} onPage={setPage}
          columns={[
            { key: "name",   label: "الموظف",   render: (l) => <span><span className="font-semibold">{l.adminName}</span> <span className="text-[11px] text-gray-400 ms-1">{ROLE_LABELS[l.role]}</span></span> },
            { key: "action", label: "الإجراء",  render: (l) => <Pill color="cyan">{ACTIVITY_LABELS[l.action]}</Pill> },
            { key: "entity", label: "العنصر",   render: (l) => <span className="text-xs text-gray-500">{l.entity} <span className="lat ms-1" dir="ltr">{l.entityId}</span></span> },
            { key: "details",label: "التفاصيل", render: (l) => <span className="text-xs text-gray-600">{l.details}</span> },
            { key: "date",   label: "الوقت",    render: (l) => <span className="text-xs text-gray-400">{relativeTime(l.createdAt)}</span> },
          ]}
        />
      </Section>
    </div>
  );
}

function SettingsAdmin() {
  const me = useCurrentAdmin();
  const toast = useToast();
  const live = useSystemSettings();
  // Draft mirrors the live store; controlled inputs write here, "حفظ" persists
  // through updateSystemSettings(). The cash-orders toggle stays live (no
  // draft) so the workflow rule reflects immediately.
  const [draft, setDraft] = useState({
    minBookingNoticeMinutes: live.minBookingNoticeMinutes,
    morningShiftStart: live.morningShiftStart,
    morningShiftEnd:   live.morningShiftEnd,
    eveningShiftStart: live.eveningShiftStart,
    eveningShiftEnd:   live.eveningShiftEnd,
    whatsappNumber:    live.whatsappNumber,
    supportedCities:   live.supportedCities,
    bookingWindowDays: live.bookingWindowDays,
    maxOrdersPerShift:  live.maxOrdersPerShift,
  });
  const [newCity, setNewCity] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty =
    draft.minBookingNoticeMinutes !== live.minBookingNoticeMinutes ||
    draft.morningShiftStart        !== live.morningShiftStart ||
    draft.morningShiftEnd          !== live.morningShiftEnd ||
    draft.eveningShiftStart        !== live.eveningShiftStart ||
    draft.eveningShiftEnd          !== live.eveningShiftEnd ||
    draft.whatsappNumber           !== live.whatsappNumber ||
    draft.bookingWindowDays        !== live.bookingWindowDays ||
    draft.maxOrdersPerShift        !== live.maxOrdersPerShift ||
    JSON.stringify(draft.supportedCities) !== JSON.stringify(live.supportedCities);

  const validate = (): string | null => {
    if (!Number.isFinite(draft.minBookingNoticeMinutes) || draft.minBookingNoticeMinutes < 0) {
      return "الحد الأدنى للحجز يجب أن يكون رقماً موجباً";
    }
    if (draft.morningShiftStart >= draft.morningShiftEnd) return "نهاية فترة الصباح يجب أن تكون بعد بدايتها";
    if (draft.eveningShiftStart >= draft.eveningShiftEnd) return "نهاية فترة المساء يجب أن تكون بعد بدايتها";
    if (draft.supportedCities.length === 0) return "يجب وجود مدينة واحدة على الأقل";
    if (!Number.isFinite(draft.bookingWindowDays) || draft.bookingWindowDays < 0) return "نافذة الحجز يجب أن تكون 0 أو أكثر (0 = اليوم فقط)";
    if (!Number.isFinite(draft.maxOrdersPerShift) || draft.maxOrdersPerShift < 0) return "الحد الأقصى للحجوزات يجب أن يكون 0 أو أكثر (0 = بدون حد)";
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 300));
    updateSystemSettings(draft);
    logActivity({
      adminId: me.id, adminName: me.name, role: me.role,
      action: "settings_change", entity: "settings", entityId: "global",
      details: "حفظ إعدادات النظام",
    });
    setSaving(false);
    setSavedAt(new Date().toLocaleTimeString("ar-SY"));
    toast.success("تم الحفظ بنجاح");
  };

  const addCity = () => {
    const c = newCity.trim();
    if (!c) return;
    if (draft.supportedCities.includes(c)) { toast.warning("المدينة مضافة مسبقاً"); return; }
    set("supportedCities", [...draft.supportedCities, c]);
    setNewCity("");
  };
  const removeCity = (c: string) => set("supportedCities", draft.supportedCities.filter((x) => x !== c));

  return (
    <div className="space-y-4">
      <Section title="إعدادات النظام">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="الحد الأدنى للحجز (دقائق)">
            <TextInput
              type="number"
              value={String(draft.minBookingNoticeMinutes)}
              onChange={(e) => set("minBookingNoticeMinutes", Number(e.target.value))}
            />
          </Field>
          <Field label="رقم واتساب الدعم">
            <TextInput
              type="tel"
              value={draft.whatsappNumber}
              onChange={(e) => set("whatsappNumber", e.target.value)}
            />
          </Field>
          <Field label="بداية فترة الصباح">
            <TextInput type="time" value={draft.morningShiftStart} onChange={(e) => set("morningShiftStart", e.target.value)} />
          </Field>
          <Field label="نهاية فترة الصباح">
            <TextInput type="time" value={draft.morningShiftEnd} onChange={(e) => set("morningShiftEnd", e.target.value)} />
          </Field>
          <Field label="بداية فترة المساء">
            <TextInput type="time" value={draft.eveningShiftStart} onChange={(e) => set("eveningShiftStart", e.target.value)} />
          </Field>
          <Field label="نهاية فترة المساء">
            <TextInput type="time" value={draft.eveningShiftEnd} onChange={(e) => set("eveningShiftEnd", e.target.value)} />
          </Field>
          <Field label="نافذة الحجز (عدد الأيام بعد اليوم)">
            <TextInput
              type="number"
              min="0"
              value={String(draft.bookingWindowDays)}
              onChange={(e) => set("bookingWindowDays", Number(e.target.value))}
            />
            <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
              مثال: ٢ يعني يستطيع العميل اختيار اليوم وغداً وبعد غد.
            </p>
          </Field>
          <Field label="الحد الأقصى للحجوزات في الفترة (0 = بدون حد)">
            <TextInput
              type="number"
              value={String(draft.maxOrdersPerShift)}
              onChange={(e) => set("maxOrdersPerShift", Number(e.target.value))}
            />
          </Field>
        </div>
      </Section>

      <Section title="قواعد الدفع وسير الطلبات">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#164E63]">السماح بالطلبات نقداً</p>
            <p className="text-xs text-gray-500">عند التفعيل تدخل طلبات الدفع نقداً سير العمل مباشرة بدون انتظار الدفع. عند الإيقاف لن يرى الممرض هذه الطلبات.</p>
          </div>
          <Toggle
            checked={live.allowCashOrders}
            onChange={(v) => {
              updateSystemSettings({ allowCashOrders: v });
              logActivity({
                adminId: me.id, adminName: me.name, role: me.role,
                action: "settings_change", entity: "settings", entityId: "allowCashOrders",
                details: v ? "السماح بطلبات الدفع نقداً" : "إيقاف طلبات الدفع نقداً",
              });
              toast.success("تم تحديث الإعداد");
            }}
            label="السماح بالطلبات نقداً"
          />
        </div>
      </Section>

      <Section title="المدن المدعومة">
        <div className="flex gap-2 flex-wrap">
          {draft.supportedCities.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#ECFEFF] text-[#0891B2] text-sm font-medium">
              {c}
              <button
                onClick={() => removeCity(c)}
                aria-label={`إزالة ${c}`}
                className="w-5 h-5 rounded-full hover:bg-cyan-100 flex items-center justify-center cursor-pointer"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          <div className="flex items-center gap-1">
            <TextInput
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCity(); } }}
              placeholder="مدينة جديدة"
              className="h-9 text-sm"
            />
            <button
              onClick={addCity}
              disabled={!newCity.trim()}
              className="px-3 py-1.5 rounded-full border border-dashed border-gray-300 text-sm text-gray-500 cursor-pointer hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + إضافة
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">يجب أن تتطابق هذه القائمة مع المدن التي تخدمها المخابر والممرضون.</p>
      </Section>

      <Section title="الخط والمحتوى">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="الخط الأساسي"><TextInput defaultValue="Readex Pro" disabled /></Field>
          <Field label="حجم النص الأساسي"><TextInput defaultValue="14px" disabled /></Field>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          الخط ثابت — Readex Pro للعربية واللاتينية. التحكم بالحجم يتم من Tailwind لاحقاً.
        </p>
      </Section>

      <div className="flex items-center justify-end gap-3">
        {savedAt && !dirty && <span className="text-xs text-emerald-600">تم الحفظ {savedAt}</span>}
        <Button size="md" loading={saving} disabled={!dirty} onClick={save}>
          حفظ الإعدادات
        </Button>
      </div>
    </div>
  );
}

// ════════════════════════════ New order drawer ══════════════════════════════
function NewOrderDrawer({ user, nurses, labs, onCancel, onCreated }: {
  user: AdminUser;
  nurses: Nurse[];
  labs: Lab[];
  onCancel: () => void;
  onCreated: (orderId: string) => void;
}) {
  const toast = useToast();
  const me = user;
  const settings = useSystemSettings();

  const customerList = useMemo(() => {
    const set = new Map<string, { userId: string; label: string }>();
    MOCK_PATIENTS.forEach((p) => {
      if (!set.has(p.userId)) set.set(p.userId, { userId: p.userId, label: p.name });
    });
    return Array.from(set.values());
  }, []);

  const [userId, setUserId] = useState<string>(customerList[0]?.userId ?? SEED_CUSTOMER_1_ID);
  const userPatients  = MOCK_PATIENTS.filter((p) => p.userId === userId);
  const userAddresses = MOCK_ADDRESSES.filter((a) => a.userId === userId);

  const [patientId, setPatientId] = useState<string>(userPatients[0]?.id ?? "");
  const [addressId, setAddressId] = useState<string>(userAddresses[0]?.id ?? "");

  const [orderType, setOrderType] = useState<"package" | "custom">("custom");
  const [packageId, setPackageId] = useState<string>("");
  const [pickedTestIds, setPickedTestIds] = useState<string[]>([]);

  const [visitDate, setVisitDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [shift, setShift] = useState<"morning" | "evening">("morning");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "online">("cash");

  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponMessage, setCouponMessage] = useState<{ text: string; valid: boolean } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  const [assignNurseId, setAssignNurseId] = useState<string>("");
  const [assignLabId, setAssignLabId] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  // Stable idempotency key for the lifetime of this drawer mount.
  const [idempotencyKey] = useState(() => `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const pkg = useMemo(() => MOCK_PACKAGES.find((p) => p.id === packageId) ?? null, [packageId]);
  const pickedTests = useMemo(() => MOCK_TESTS.filter((t) => pickedTestIds.includes(t.id)), [pickedTestIds]);
  const subtotal = orderType === "package" && pkg
    ? pkg.price
    : pickedTests.reduce((s, t) => s + t.sellPrice, 0);
  const total = Math.max(0, subtotal - couponDiscount);

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    const result = await apiValidateCoupon(couponCode.trim(), subtotal);
    setCouponLoading(false);
    if (result.valid && result.discount) {
      setCouponDiscount(result.discount);
      setCouponMessage({ text: result.message, valid: true });
    } else {
      setCouponDiscount(0);
      setCouponMessage({ text: result.message, valid: false });
    }
  };

  const togglePickTest = (id: string) => {
    setPickedTestIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    if (couponDiscount > 0) { setCouponDiscount(0); setCouponMessage(null); }
  };

  const validate = (): string | null => {
    if (!userId) return "اختر العميل";
    if (!patientId) return "اختر المريض";
    if (!addressId) return "اختر العنوان";
    if (orderType === "package" && !pkg) return "اختر باقة";
    if (orderType === "custom" && pickedTests.length === 0) return "أضف تحليلاً واحداً على الأقل";
    if (!visitDate) return "اختر تاريخ الزيارة";
    if (paymentMethod === "cash" && !settings.allowCashOrders)
      return "الدفع نقداً معطّل من الإعدادات حالياً";
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 300));

    const patient = userPatients.find((p) => p.id === patientId)!;
    const address = userAddresses.find((a) => a.id === addressId)!;
    const items = orderType === "package" && pkg
      ? pkg.tests.map((t, i) => ({ id: `oi-${Date.now()}-${i}`, testId: t.id, nameAr: t.nameAr, nameEn: t.nameEn, priceSnapshot: t.sellPrice }))
      : pickedTests.map((t, i) => ({ id: `oi-${Date.now()}-${i}`, testId: t.id, nameAr: t.nameAr, nameEn: t.nameEn, priceSnapshot: t.sellPrice }));

    const initialStatus =
      paymentMethod === "cash" && settings.allowCashOrders
        ? "confirmed"
        : "created";

    const order = createOrder({
      idempotencyKey,
      userId,
      type: orderType,
      packageSnapshot: pkg ? {
        packageId: pkg.id, nameAr: pkg.nameAr, nameEn: pkg.nameEn,
        image: pkg.mainImage, testsCount: pkg.tests.length, price: pkg.price,
      } : undefined,
      packageNameAr: pkg?.nameAr,
      items,
      subtotal,
      couponCode: couponDiscount > 0 ? couponCode : undefined,
      couponDiscount,
      total,
      shift,
      visitDate,
      address,
      patient,
      paymentMethod,
      paymentStatus: "pending",
      instructions: dedupeInstructions(COMMON_INSTRUCTIONS),
      publicNumber: generateOrderNumber(),
      initialStatus,
    });

    if (assignNurseId) {
      const { assignNurse } = await import("@/lib/store");
      assignNurse(order.id, assignNurseId, { actor: "admin", actorName: me.name });
    }
    if (assignLabId) {
      const { assignLab } = await import("@/lib/store");
      assignLab(order.id, assignLabId, { actor: "admin", actorName: me.name });
    }

    logActivity({
      adminId: me.id, adminName: me.name, role: me.role,
      action: "order_update", entity: "order", entityId: order.id,
      details: `إنشاء طلب جديد ${order.publicNumber}`,
    });
    setSubmitting(false);
    toast.success(`تم إنشاء الطلب ${order.publicNumber}`);
    onCreated(order.id);
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] flex">
      <button type="button" aria-label="إلغاء" onClick={onCancel} className="flex-1 bg-black/50 cursor-pointer" />
      <div className="bg-white w-full max-w-xl h-full overflow-hidden flex flex-col shadow-[0_0_40px_rgba(0,0,0,0.18)]">
        <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-bold text-[#164E63]">إنشاء طلب جديد</h3>
          <button onClick={onCancel} aria-label="إغلاق" className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer">
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <Section title="العميل والمريض">
            <Field label="العميل">
              <select
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  const newPatients  = MOCK_PATIENTS.filter((p) => p.userId === e.target.value);
                  const newAddresses = MOCK_ADDRESSES.filter((a) => a.userId === e.target.value);
                  setPatientId(newPatients[0]?.id ?? "");
                  setAddressId(newAddresses[0]?.id ?? "");
                }}
                className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer"
              >
                {customerList.map((c) => <option key={c.userId} value={c.userId}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="المريض">
              <select value={patientId} onChange={(e) => setPatientId(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
                <option value="">— اختر —</option>
                {userPatients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="العنوان">
              <select value={addressId} onChange={(e) => setAddressId(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
                <option value="">— اختر —</option>
                {userAddresses.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.description}</option>)}
              </select>
            </Field>
          </Section>

          <Section title="العناصر">
            <Field label="نوع الطلب">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setOrderType("package")} aria-pressed={orderType === "package"} className={`text-xs py-2 rounded-lg border-2 cursor-pointer ${orderType === "package" ? "border-[#0891B2] bg-[#ECFEFF] text-[#0891B2]" : "border-gray-200 bg-white text-gray-500"}`}>
                  باقة جاهزة
                </button>
                <button type="button" onClick={() => setOrderType("custom")} aria-pressed={orderType === "custom"} className={`text-xs py-2 rounded-lg border-2 cursor-pointer ${orderType === "custom" ? "border-[#0891B2] bg-[#ECFEFF] text-[#0891B2]" : "border-gray-200 bg-white text-gray-500"}`}>
                  تحاليل مختارة
                </button>
              </div>
            </Field>

            {orderType === "package" ? (
              <Field label="الباقة">
                <select value={packageId} onChange={(e) => setPackageId(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
                  <option value="">— اختر باقة —</option>
                  {MOCK_PACKAGES.filter((p) => p.isActive).map((p) => (
                    <option key={p.id} value={p.id}>{p.nameAr} — {formatPrice(p.price)}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="التحاليل">
                <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-50">
                  {MOCK_TESTS.filter((t) => t.isActive).map((t) => {
                    const checked = pickedTestIds.includes(t.id);
                    return (
                      <label key={t.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs hover:bg-gray-50">
                        <input type="checkbox" checked={checked} onChange={() => togglePickTest(t.id)} className="w-4 h-4" />
                        <span className="flex-1 text-[#164E63]">{t.nameAr}</span>
                        <span className="text-gray-500">{formatPrice(t.sellPrice)}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">{pickedTests.length} مختارة · {formatPrice(subtotal)}</p>
              </Field>
            )}
          </Section>

          <Section title="الموعد والدفع">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="تاريخ الزيارة"><TextInput type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} /></Field>
              <Field label="الفترة">
                <select value={shift} onChange={(e) => setShift(e.target.value as "morning" | "evening")} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
                  <option value="morning">صباح (8:00 – 10:00)</option>
                  <option value="evening">مساء (4:00 – 6:00)</option>
                </select>
              </Field>
              <Field label="طريقة الدفع">
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "cash" | "online")} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
                  <option value="cash">نقداً</option>
                  <option value="online">إلكتروني</option>
                </select>
                {paymentMethod === "online" && (
                  <p className="text-[11px] text-amber-600 mt-1">الطلب الإلكتروني يبقى بانتظار الدفع ولا يصل الممرض حتى يُؤكَّد الدفع.</p>
                )}
                {paymentMethod === "cash" && !settings.allowCashOrders && (
                  <p className="text-[11px] text-red-600 mt-1">الدفع نقداً معطّل من الإعدادات.</p>
                )}
              </Field>
            </div>
          </Section>

          <Section title="كوبون الخصم (اختياري)">
            <div className="flex gap-2">
              <input
                value={couponCode} onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponMessage(null); }}
                placeholder="كود الكوبون"
                className="flex-1 h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr"
              />
              <Button size="sm" variant="outline" onClick={applyCoupon} loading={couponLoading} className="h-10">تطبيق</Button>
            </div>
            {couponMessage && (
              <p className={`text-[11px] mt-1 ${couponMessage.valid ? "text-emerald-600" : "text-red-600"}`}>{couponMessage.text}</p>
            )}
          </Section>

          <Section title="إسناد (اختياري)">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="الممرض">
                <select value={assignNurseId} onChange={(e) => setAssignNurseId(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
                  <option value="">— غير معيّن —</option>
                  {nurses.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </Field>
              <Field label="المخبر">
                <select value={assignLabId} onChange={(e) => setAssignLabId(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
                  <option value="">— غير معيّن —</option>
                  {labs.map((l) => <option key={l.id} value={l.id}>{l.nameAr}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="ملخص">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">المجموع</span><span className="font-semibold">{formatPrice(subtotal)}</span></div>
              {couponDiscount > 0 && (
                <div className="flex justify-between"><span className="text-gray-500">كوبون {couponCode}</span><span className="text-emerald-600 font-semibold">-{formatPrice(couponDiscount)}</span></div>
              )}
              <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1.5"><span className="font-bold text-[#164E63]">الإجمالي</span><span className="font-bold text-[#164E63]">{formatPrice(total)}</span></div>
            </div>
          </Section>
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 flex-shrink-0">
          <Button variant="outline" size="md" onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" size="md" loading={submitting} onClick={submit}>إنشاء الطلب</Button>
        </footer>
      </div>
    </div>
  );
}
