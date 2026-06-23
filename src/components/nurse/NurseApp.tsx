"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home as HomeIcon, Calendar, Settings as SettingsIcon, Bell, MapPin, Phone,
  CheckCircle2, AlertCircle, Navigation, Clock, ChevronRight, Trophy, Flame,
  Star, Award, TrendingUp, Target, BadgeCheck, ListChecks, ArrowLeft, Package,
  XCircle, Wrench, Droplets, Wallet, Plus, Minus,
} from "lucide-react";
import { NurseWallet } from "@/components/nurse/NurseWallet";
import {
  FAILED_COLLECTION_REASONS, NURSE_BADGES,
} from "@/lib/mock-data";
import { apiConfirmPrep, apiGetPrepConfirmation, type PrepConfirmedItem } from "@/lib/nurse-api";
import { useNurseGamification } from "@/lib/nurse-gamification";
import { usePersistedNav } from "@/lib/use-persisted-nav";
import type { Nurse, NurseRouteStop, NurseGamification, Notification, Order } from "@/lib/types";
import {
  setOrderStatus, verifyPatient, collectCash, useOrders,
  hydrateOrdersForNurse, hydrateNotificationsForNurse,
  useNurseNotifications, markNurseNotificationRead,
} from "@/lib/store";
import { useEditableNurse, updateNurseProfile } from "@/lib/nurse-profile";
import { useSystemSettings } from "@/lib/system-settings";
import { instructionsForOrder, isStructuredInstructions, customerOrderRef } from "@/lib/order-utils";
import { useToast } from "@/components/ui/Toast";
import { useLibraryTools, useChecklistDefaults } from "@/lib/tool-library";
import { aggregateNurseTools } from "@/lib/tool-aggregation";
import { submitShortageRequest } from "@/lib/shortage-requests";
import type { TestInstruction, Instruction } from "@/lib/types";
import { formatDate, formatPrice, getShiftLabel, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { BackButton } from "@/components/ui/BackButton";
import { useSession, useAuthStatus, logout, nurseFromSession } from "@/lib/auth";
import { AuthLoading } from "@/components/auth/AuthLoading";
import { NurseLogin } from "@/components/nurse/NurseLogin";
import { USE_SUPABASE } from "@/lib/supabase/flags";
import { isUuid } from "@/lib/supabase/uuid";
import { hydrateNurseOnline, setNurseOnline, useNurseOnline } from "@/lib/nurse-online";
import { hydrateShortageRequestsForNurse } from "@/lib/shortage-requests";

type NurseTab = "home" | "schedule" | "wallet" | "settings";

// One row of the morning prep list. `required` is the auto-computed quantity
// (sum of quantity_per_test across today's tests); `hasQuantity` is false in the
// presence-only fallback (no test→tool mapping), where `required` is just 1 and
// the row is a tick. `mustCover` rows block day-start until prepared >= required.
type PrepItem = {
  toolId: string;
  nameAr: string;
  unit: string;
  required: number;
  hasQuantity: boolean;
  mustCover: boolean;
};

// Compose the nurse-visible address string. Spec: don't show the "label"
// (e.g. "المنزل") — show area/city + description so the nurse sees where
// they're going, not how the customer named the spot.
function nurseAddressDisplay(addr: import("@/lib/types").Address): string {
  const head = addr.city?.trim();
  const tail = addr.description?.trim();
  if (head && tail) return `${head} — ${tail}`;
  return tail || head || "";
}

// STORAGE POLICY: sessionStorage manual reorder is a UX hint only — it
// preserves the nurse's chosen visit order within a single tab/day.
// NEVER persists business data: the canonical visit list comes from
// `useOrders()` filtered by nurse + date. Clearing the key only resets
// the optional ordering preference; visits remain intact.
function manualOrderKey(nurseId: string, date: string): string {
  return `makhbartak.nurse.manualOrder.${nurseId}.${date}`;
}
function readNurseManualOrder(nurseId: string, date: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(manualOrderKey(nurseId, date));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as string[]).filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
function writeNurseManualOrder(nurseId: string, date: string, ids: string[]) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(manualOrderKey(nurseId, date), JSON.stringify(ids)); } catch {}
}

export function NurseApp() {
  const session = useSession();
  const authStatus = useAuthStatus();
  if (authStatus === "loading") return <AuthLoading />;
  if (!session || session.role !== "nurse") return <NurseLogin />;
  const nurseRecord = nurseFromSession(session);
  if (!nurseRecord) return <NurseLogin />;
  const handleLogout = () => {
    // Don't clear the prep state on logout — that used to re-show the
    // checklist on every fresh login. Online/offline lives on the nurse
    // row and persists across sessions; the nurse can flip it from the UI.
    logout();
  };
  return <NurseAppInner nurseId={nurseRecord.id} onLogout={handleLogout} />;
}

function NurseAppInner({ nurseId, onLogout }: { nurseId: string; onLogout: () => void }) {
  const session = useSession();
  const editableNurse = useEditableNurse(nurseId);
  // FINAL HARDENING: nurse identity is derived from the enriched session
  // alone. The MOCK_NURSES seed-id fallback has been removed so demo
  // metadata can never leak into a real nurse session.
  const sessionNurse: Nurse = {
    id: nurseId,
    name: session?.name || "—",
    phone: "",
    city: session?.nurseCity ?? "",
    photoUrl: session?.nursePhotoUrl,
    isActive: true,
  };
  const nurse = editableNurse ?? sessionNurse;
  // Gamification: Phase 1 hardening. The nurse row is fetched (and auto-
  // created for new admin-created nurses) via the GET endpoint. Until the
  // network round-trip lands, the hook returns a starter shape so the UI
  // never reads `.level` from undefined.
  const game = useNurseGamification(nurse.id);
  // Today (local date) — used for the prep-checklist key and the schedule
  // header. Computed from local components so it matches the date strings
  // we send to /api/orders and the visit_date column.
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const settings = useSystemSettings();
  const toast = useToast();

  const [tab, setTab] = usePersistedNav<NurseTab>("makhbartak.nurse.nav.v1", "home");

  // "started" is the persistent DB `is_online` flag. The prep list appears only
  // while offline; tapping "بدأت يومي" flips to online server-side.
  const isOnline = useNurseOnline();
  const started = isOnline;

  // Explicit prepared quantities the nurse has entered or loaded, keyed by tool
  // id. Anything NOT in this map falls back to the computed required amount at
  // render time (see `preparedFor`), so there is no seeding effect. Seeded from
  // today's confirmation if one exists; persisted back on day start.
  const [prepared, setPrepared] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!(USE_SUPABASE && isUuid(nurseId))) return;
    void hydrateNurseOnline(nurseId);
    void (async () => {
      const conf = await apiGetPrepConfirmation(nurseId, todayStr);
      if (!conf?.confirmedItems?.length) return;
      const seed: Record<string, number> = {};
      for (const it of conf.confirmedItems) {
        if (it?.toolId) seed[it.toolId] = Number(it.prepared ?? 0);
      }
      // `prev` wins so a value the nurse already touched this session is kept.
      setPrepared((prev) => ({ ...seed, ...prev }));
    })();
  }, [nurseId, todayStr]);

  // Notifications — DB-only. The mock seed has been removed; admin-created
  // nurses see whatever rows the notifications table has for their
  // profile_id (hydrated by hydrateNotificationsForNurse on mount).
  const [notifOpen, setNotifOpen] = useState(false);
  const notifs = useNurseNotifications();
  const unread = notifs.filter((n) => !n.isRead).length;

  // Phase 2: pull this nurse's orders from Supabase on mount when the flag
  // is on. Stage C also pulls the nurse's shortage requests. Both are no-ops
  // in mock-only mode.
  useEffect(() => {
    void hydrateOrdersForNurse(nurse.id);
    void hydrateShortageRequestsForNurse(nurse.id);
    void hydrateNotificationsForNurse(nurse.id);
  }, [nurse.id]);

  // Visit detail flow — every stop comes from the live order store now.
  // Old code derived stops from MOCK_NURSE_ROUTES (keyed by SEED_NURSE_*
  // slugs) which silently produced an empty schedule for any admin-created
  // nurse. The DB is the source of truth: we filter `liveOrders` by
  // nurse.id and bucket by status. No payment-method gate — admin assigned
  // these orders intentionally; the nurse needs to see them regardless of
  // cash/online status. Cancelled / lab_issue stay visible as "failed" so
  // the nurse can see context, not so they can act on them.
  const liveOrders = useOrders();
  const [activeStopId, setActiveStopId] = useState<string | null>(null);

  // Bump on manual reorder so groupedByDate re-runs against the freshly
  // persisted override list.
  const [manualVersion, setManualVersion] = useState(0);
  const bumpManual = () => setManualVersion((v) => v + 1);
  void manualVersion; // referenced by groupedByDate via closure capture below.

  const myOrders = liveOrders.filter((o) => isUuid(o.id) && o.nurseId === nurse.id);

  // Stop bucket derived from the order status (TS shape after mapRowToOrder).
  const bucketFor = (status: Order["status"]): NurseRouteStop["status"] => {
    if (["sample_collected", "sent_to_lab", "lab_processing", "result_ready", "completed"].includes(status)) return "completed";
    if (["failed_to_collect", "cancelled", "lab_issue"].includes(status)) return "failed";
    return "pending";
  };

  // Group by visit_date. Today first, then chronological.
  const groupedByDate = (() => {
    const map = new Map<string, Order[]>();
    for (const o of myOrders) {
      const arr = map.get(o.visitDate) ?? [];
      arr.push(o);
      map.set(o.visitDate, arr);
    }
    const dates = Array.from(map.keys()).sort();
    // Move today to the front if present so the schedule banner reads
    // "اليوم" first.
    const orderedDates = [todayStr, ...dates.filter((d) => d !== todayStr && d >= todayStr)];
    return orderedDates
      .filter((d) => map.has(d) || d === todayStr)
      .map((date) => {
        // Sort: morning first, evening second. Within a shift, by
        // shiftStartTime then by created_at as a stable tiebreaker.
        const shiftRank = (s: Order["shift"]) => (s === "morning" ? 0 : 1);
        const orders = (map.get(date) ?? []).slice().sort((a, b) => {
          const r = shiftRank(a.shift) - shiftRank(b.shift);
          if (r !== 0) return r;
          const aT = a.shiftStartTime ?? "";
          const bT = b.shiftStartTime ?? "";
          if (aT !== bT) return aT.localeCompare(bT);
          return a.createdAt.localeCompare(b.createdAt);
        });
        // Apply any manual reorder the nurse has set for this day. The
        // overrides are an array of order ids in the desired display
        // order; unknown ids fall through to the natural sort above.
        const manual = readNurseManualOrder(nurse.id, date);
        const finalOrders = manual.length === 0
          ? orders
          : (() => {
              const idx = new Map(manual.map((id, i) => [id, i] as const));
              return orders.slice().sort((a, b) => {
                const ai = idx.get(a.id);
                const bi = idx.get(b.id);
                if (ai !== undefined && bi !== undefined) return ai - bi;
                if (ai !== undefined) return -1;
                if (bi !== undefined) return 1;
                return 0;
              });
            })();
        return {
          date,
          stops: finalOrders.map<NurseRouteStop>((o, idx) => ({
            orderId: o.id, order: o, sequence: idx + 1, status: bucketFor(o.status),
          })),
        };
      });
  })();

  // Today's stops drive the home tab.
  const todayGroup = groupedByDate.find((g) => g.date === todayStr);
  const stopsHydrated: NurseRouteStop[] = todayGroup?.stops ?? [];
  const activeStop = activeStopId ? stopsHydrated.find((s) => s.orderId === activeStopId) ?? null : null;
  const setActiveStop = (s: NurseRouteStop | null) => setActiveStopId(s ? s.orderId : null);

  const completed = stopsHydrated.filter((s) => s.status === "completed").length;
  const remaining = stopsHydrated.filter((s) => s.status === "pending").length;
  const failed = stopsHydrated.filter((s) => s.status === "failed").length;
  const nextStop = stopsHydrated.find((s) => s.status === "pending");

  const ref = { actor: "nurse" as const, actorName: nurse.name };

  // The schedule tab consumes a 3-day window starting today.
  const scheduleRoutes = (() => {
    const out: { nurseId: string; date: string; stops: NurseRouteStop[] }[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const grp = groupedByDate.find((g) => g.date === date);
      out.push({ nurseId: nurse.id, date, stops: grp?.stops ?? [] });
    }
    return out;
  })();

  void settings; // settings still drives gamification + future capacity gates.

  const updateStopStatus = () => {
    // No-op on stop bucket: it's derived from order.status now. The store
    // reflects the API result via `liveOrders`, and `groupedByDate`
    // re-buckets automatically. Closing the visit detail is the only
    // remaining UX concern here.
    setActiveStop(null);
  };

  const completeStop = async (orderId: string) => {
    const r = await setOrderStatus(orderId, "sample_collected", ref);
    if (!r.ok) return r;
    updateStopStatus();
    return r;
  };

  const failStop = async (orderId: string, reasonValue: string) => {
    const reason = FAILED_COLLECTION_REASONS.find((rr) => rr.value === reasonValue)?.labelAr ?? reasonValue;
    const r = await setOrderStatus(orderId, "failed_to_collect", ref, reason);
    if (!r.ok) return r;
    updateStopStatus();
    return r;
  };

  // ─── Morning prep: required tools + quantities (from today's orders) ──────
  const toolsCatalog = useLibraryTools();
  const checklistDefaults = useChecklistDefaults();
  const todaysOrders = stopsHydrated.map((s) => s.order);
  const aggregated = aggregateNurseTools({
    orders: todaysOrders,
    defaults: checklistDefaults,
    toolsCatalog,
  });

  // Primary path: per-test tool requirements (lab_test_required_tools →
  // Test.nurseTools) summed across today's orders, so each tool shows the exact
  // quantity needed (`required` = raw summed quantity). When no test carries a
  // tool mapping we fall back to the admin nurse_tools catalog as a plain
  // presence checklist and flag that quantities weren't auto-computed.
  const hasMapping = aggregated.length > 0;
  const prepItems: PrepItem[] = hasMapping
    ? aggregated.map((r) => ({
        toolId: r.toolId, nameAr: r.nameAr, unit: r.unit,
        required: r.qtyRaw, hasQuantity: true, mustCover: r.required,
      }))
    : toolsCatalog.filter((t) => t.isActive).map((t) => ({
        toolId: t.id, nameAr: t.nameAr, unit: t.unit,
        required: 1, hasQuantity: false, mustCover: true,
      }));

  // Effective prepared amount: an explicit entry wins, otherwise default to the
  // required quantity (quantity mode — the nurse confirms/adjusts) or 0
  // (presence mode — the nurse ticks). Derived at render, so no seeding effect.
  const preparedFor = (it: PrepItem) => prepared[it.toolId] ?? (it.hasQuantity ? it.required : 0);
  const thresholdFor = (it: PrepItem) => (it.hasQuantity ? it.required : 1);
  const isCovered = (it: PrepItem) => preparedFor(it) >= thresholdFor(it);
  const allReady = prepItems.length > 0 && prepItems.filter((it) => it.mustCover).every(isCovered);
  const readyCount = prepItems.filter(isCovered).length;

  // Default-filled map handed to the UI so rows render the effective quantities.
  const effectivePrepared: Record<string, number> = {};
  for (const it of prepItems) effectivePrepared[it.toolId] = preparedFor(it);

  const setPreparedFor = (toolId: string, qty: number) =>
    setPrepared((prev) => ({ ...prev, [toolId]: Math.max(0, Math.floor(qty) || 0) }));

  const startDay = async () => {
    // Quantity coverage is a UX gate; the hard server gate is the confirmation
    // row itself (the /online route refuses to go online without it). We persist
    // the full required/prepared breakdown into the confirmation for audit.
    if (!allReady) {
      toast.error("يرجى تجهيز جميع الأدوات بالكميات المطلوبة قبل بدء اليوم");
      return;
    }
    const items: PrepConfirmedItem[] = prepItems.map((it) => ({
      toolId: it.toolId, nameAr: it.nameAr, unit: it.unit,
      required: it.hasQuantity ? it.required : 0,
      prepared: preparedFor(it),
    }));
    const conf = await apiConfirmPrep(nurseId, todayStr, items);
    if (!conf.ok) {
      toast.error(conf.error ?? "تعذر تأكيد جاهزية الأدوات");
      return;
    }
    const r = await setNurseOnline(nurseId, true);
    if (!r.ok) toast.error(r.error ?? "تعذر تفعيل وضع العمل");
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 max-w-md mx-auto">
      <div className="flex-1 pb-nav">
        {tab === "home" && (
          <NurseHome
            nurse={nurse}
            game={game}
            unread={unread}
            today={todayStr}
            prepItems={prepItems}
            hasMapping={hasMapping}
            prepared={effectivePrepared}
            onChangePrepared={setPreparedFor}
            allReady={allReady}
            readyCount={readyCount}
            started={started}
            onStartDay={startDay}
            stops={stopsHydrated}
            nextStop={nextStop}
            completed={completed}
            remaining={remaining}
            failed={failed}
            onOpenNotifs={() => setNotifOpen(true)}
            onOpenStop={(s) => setActiveStop(s)}
          />
        )}

        {tab === "schedule" && (
          <NurseSchedule
            routes={scheduleRoutes}
            stopsToday={stopsHydrated}
            onOpenStop={(s) => setActiveStop(s)}
            onMove={(date, orderId, delta) => {
              const grp = groupedByDate.find((g) => g.date === date);
              if (!grp) return;
              const ids = grp.stops.map((s) => s.orderId);
              const i = ids.indexOf(orderId);
              const j = i + delta;
              if (i === -1 || j < 0 || j >= ids.length) return;
              [ids[i], ids[j]] = [ids[j], ids[i]];
              writeNurseManualOrder(nurse.id, date, ids);
              bumpManual();
            }}
          />
        )}

        {tab === "wallet" && <NurseWallet nurseId={nurse.id} />}

        {tab === "settings" && <NurseSettings nurse={nurse} game={game} onLogout={onLogout} isOnline={isOnline} onToggleOnline={async () => {
          const r = await setNurseOnline(nurse.id, !isOnline);
          if (!r.ok) toast.error(r.error ?? "تعذر تحديث وضع العمل");
        }} />}
      </div>

      {/* Bottom nav */}
      <nav
        className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 safe-bottom-sm z-30 max-w-md mx-auto"
        aria-label="التنقل"
      >
        <div className="grid grid-cols-4 h-16">
          {([
            { id: "home" as const,     Icon: HomeIcon,   label: "الرئيسية" },
            { id: "schedule" as const, Icon: Calendar,   label: "الجدول" },
            { id: "wallet" as const,   Icon: Wallet,     label: "المحفظة" },
            { id: "settings" as const, Icon: SettingsIcon, label: "الإعدادات" },
          ]).map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 cursor-pointer relative ${
                  isActive ? "text-[#0891B2]" : "text-gray-400"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="nurse-nav-pill"
                    className="absolute top-0 inset-x-3 h-0.5 bg-[#0891B2] rounded-full"
                    transition={{ type: "spring", damping: 28, stiffness: 320 }}
                  />
                )}
                <t.Icon size={22} aria-hidden="true" />
                <span className="text-[11px] font-medium leading-none">{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Notifications sheet */}
      <BottomSheet open={notifOpen} onClose={() => setNotifOpen(false)} title="الإشعارات">
        <NurseNotifList
          notifs={notifs}
          onRead={(id) => markNurseNotificationRead(id, nurse.id)}
        />
      </BottomSheet>

      {/* Visit detail */}
      <AnimatePresence>
        {activeStop && (
          <NurseVisitDetail
            stop={activeStop}
            nurseName={nurse.name}
            onBack={() => setActiveStop(null)}
            onSetOnTheWay={() => setOrderStatus(activeStop.orderId, "on_the_way", ref)}
            onSetArrived={() => setOrderStatus(activeStop.orderId, "arrived", ref)}
            onComplete={() => completeStop(activeStop.orderId)}
            onFail={(reason) => failStop(activeStop.orderId, reason)}
            onDeliveredToLab={() => setOrderStatus(activeStop.orderId, "sent_to_lab", ref)}
            onVerifyPatient={(officialName, nationalId, note) => verifyPatient(activeStop.orderId, { officialName, nationalId, note }, ref)}
            onConfirmCash={() => collectCash(activeStop.orderId, ref)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ────────────────────────────── Home ────────────────────────────────────────

function NurseHome({
  nurse, game, unread, today, prepItems, hasMapping, prepared, onChangePrepared,
  allReady, readyCount, started, onStartDay,
  stops, nextStop, completed, remaining, failed, onOpenNotifs, onOpenStop,
}: {
  nurse: Nurse;
  game: NurseGamification;
  unread: number;
  today: string;
  prepItems: PrepItem[];
  hasMapping: boolean;
  prepared: Record<string, number>;
  onChangePrepared: (toolId: string, qty: number) => void;
  allReady: boolean;
  readyCount: number;
  started: boolean;
  onStartDay: () => void;
  stops: NurseRouteStop[];
  nextStop?: NurseRouteStop;
  completed: number;
  remaining: number;
  failed: number;
  onOpenNotifs: () => void;
  onOpenStop: (s: NurseRouteStop) => void;
}) {
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "صباح الخير";
    if (h < 18) return "مساء الخير";
    return "مساء النور";
  })();
  const [shortageOpen, setShortageOpen] = useState(false);
  const [reviewOpen,   setReviewOpen]   = useState(false);
  const toast = useToast();

  return (
    <div className="space-y-4 px-4 pt-5 pb-2">
      {/* Top profile row */}
      <header className="flex items-center gap-3">
        <div className="relative w-12 h-12 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
          {nurse.photoUrl && (
            <Image src={nurse.photoUrl} alt={nurse.name} fill className="object-cover" sizes="48px" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500">{greeting}</p>
          <p className="text-base font-bold text-[#164E63] truncate">{nurse.name}</p>
        </div>
        <button
          onClick={onOpenNotifs}
          aria-label={unread > 0 ? `الإشعارات — ${unread} غير مقروء` : "الإشعارات"}
          className="relative w-11 h-11 rounded-xl bg-white border border-gray-100 flex items-center justify-center cursor-pointer active:bg-gray-50"
        >
          <Bell size={18} className="text-[#164E63]" aria-hidden="true" />
          {unread > 0 && (
            <span
              className="absolute -top-1 -end-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1"
              aria-hidden="true"
            >
              {unread}
            </span>
          )}
        </button>
      </header>

      {/* Date + motivational */}
      <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-0.5">اليوم</p>
          <p className="text-sm font-semibold text-[#164E63]">{formatDate(today)}</p>
        </div>
        <div className="flex items-center gap-1.5 text-[#0E7490] text-xs">
          <TrendingUp size={14} aria-hidden="true" />
          <span>كل زيارة بتفرق — يومك بعنايتك</span>
        </div>
      </div>

      {!started ? (
        <>
          <PrepChecklist
            items={prepItems}
            hasMapping={hasMapping}
            prepared={prepared}
            onChange={onChangePrepared}
            onStart={onStartDay}
            allReady={allReady}
            readyCount={readyCount}
          />
          <button
            onClick={() => setShortageOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-amber-200 bg-amber-50/40 text-amber-700 text-sm font-semibold cursor-pointer active:bg-amber-50"
          >
            <AlertCircle size={15} aria-hidden="true" />
            أحتاج أدوات إضافية
          </button>
        </>
      ) : (
        <>
          {/* Day started — prep list becomes read-only via this entry. */}
          <TodayToolsCard onOpen={() => setReviewOpen(true)} totalCount={prepItems.length} readyCount={readyCount} />

          {stops.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
              <ListChecks size={28} className="text-gray-300 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#164E63]">لا توجد زيارات مخصصة لك حالياً</p>
              <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">سيظهر هنا أي طلب يتم إسناده إليك من الإدارة.</p>
            </div>
          ) : nextStop ? (
            <NextVisitCard stop={nextStop} onOpen={() => onOpenStop(nextStop)} />
          ) : (
            <DayDoneCard count={completed} />
          )}

          {/* Today summary */}
          <section className="grid grid-cols-3 gap-2">
            <SummaryStat label="إجمالي" value={stops.length} color="text-[#0891B2]" Icon={ListChecks} />
            <SummaryStat label="مكتمل" value={completed} color="text-emerald-600" Icon={CheckCircle2} />
            <SummaryStat label="متبقي" value={remaining} color="text-amber-600" Icon={Clock} />
          </section>
          {failed > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-start gap-2">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-red-700">{failed} زيارة لم تكتمل — يرجى المتابعة مع الإدارة</p>
            </div>
          )}
        </>
      )}

      {/* Gamification */}
      <GameWidget game={game} />

      {/* Shortage request — pre-start only */}
      <BottomSheet open={shortageOpen} onClose={() => setShortageOpen(false)} title="طلب أدوات إضافية">
        <ShortageRequestForm
          nurseId={nurse.id}
          nurseName={nurse.name}
          date={today}
          onCancel={() => setShortageOpen(false)}
          onSubmit={(reqId, error) => {
            if (!reqId) {
              toast.error(error ?? "تعذر إرسال طلب الأدوات");
              return;
            }
            setShortageOpen(false);
            toast.success("تم إرسال طلب الأدوات للإدارة");
          }}
        />
      </BottomSheet>

      {/* Today's tools — read-only review (post-start) */}
      <BottomSheet open={reviewOpen} onClose={() => setReviewOpen(false)} title="أدواتي اليوم">
        <div className="px-4 pb-4">
          <p className="text-[11px] text-gray-500 mb-3">الكميات التي جهّزتها هذا الصباح. للقراءة فقط.</p>
          <ul className="space-y-1.5">
            {prepItems.map((it) => {
              const prep = prepared[it.toolId] ?? 0;
              return (
                <li
                  key={it.toolId}
                  className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-[#164E63]"
                >
                  <span className="flex-1">{it.nameAr}</span>
                  {it.hasQuantity ? (
                    <span className="text-[11px] text-gray-500">
                      جُهّز <span className="lat font-semibold text-[#164E63]">{prep}</span>
                      {" / "}مطلوب <span className="lat">{it.required}</span> {it.unit}
                    </span>
                  ) : (
                    <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${prep >= 1 ? "border-[#0891B2] bg-[#0891B2]" : "border-gray-300"}`}>
                      {prep >= 1 && <CheckCircle2 size={11} className="text-white" aria-hidden="true" />}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </BottomSheet>
    </div>
  );
}

function TodayToolsCard({ onOpen, totalCount, readyCount }: { onOpen: () => void; totalCount: number; readyCount: number }) {
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-3 p-4 rounded-2xl border border-gray-100 bg-white text-start cursor-pointer active:bg-gray-50"
    >
      <div className="w-10 h-10 rounded-xl bg-[#ECFEFF] flex items-center justify-center flex-shrink-0">
        <Wrench size={18} className="text-[#0891B2]" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-[#164E63]">أدواتي اليوم</p>
        <p className="text-[11px] text-gray-500 mt-0.5">عرض الأدوات والكميات بعد بدء اليوم — للقراءة فقط</p>
      </div>
      <span className="text-[11px] font-semibold text-[#0891B2] lat">{readyCount} / {totalCount}</span>
    </button>
  );
}

function PrepChecklist({
  items, hasMapping, prepared, onChange, onStart, allReady, readyCount,
}: {
  items: PrepItem[];
  hasMapping: boolean;
  prepared: Record<string, number>;
  onChange: (toolId: string, qty: number) => void;
  onStart: () => void;
  allReady: boolean;
  readyCount: number;
}) {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
        <Wrench size={28} className="text-gray-300 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-gray-500">لا توجد أدوات لتجهيزها اليوم</p>
        <button onClick={onStart} className="mt-3 text-xs text-[#0891B2] cursor-pointer">بدأ يومي</button>
      </div>
    );
  }
  const pct = Math.round((readyCount / items.length) * 100);
  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3" aria-labelledby="prep-title">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#ECFEFF] flex items-center justify-center flex-shrink-0">
          <Wrench size={17} className="text-[#0891B2]" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <h2 id="prep-title" className="text-sm font-bold text-[#164E63]">الأدوات المطلوبة لليوم</h2>
          <p className="text-[11px] text-gray-500">
            {hasMapping
              ? "الكميات محسوبة تلقائياً حسب زيارات اليوم — أكّد ما جهّزته"
              : "أكّد توفّر كل أداة قبل بدء اليوم"}
          </p>
        </div>
        <span className="text-xs font-semibold text-[#0891B2] lat">{readyCount}/{items.length}</span>
      </div>

      {!hasMapping && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          <AlertCircle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-[11px] text-amber-700 leading-relaxed">لم يتم تحديد الكميات تلقائياً — أكّد توفّر الأدوات.</p>
        </div>
      )}

      {/* Progress */}
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <motion.div
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3 }}
          className="h-full bg-[#0891B2]"
        />
      </div>

      <ul className="space-y-1.5" role="list">
        {items.map((it) => (
          <PrepRow
            key={it.toolId}
            item={it}
            prepared={prepared[it.toolId] ?? 0}
            onChange={(q) => onChange(it.toolId, q)}
          />
        ))}
      </ul>

      <Button size="lg" className="w-full" onClick={onStart} disabled={!allReady}>
        بدأت يومي
      </Button>
      {!allReady && (
        <p className="text-[11px] text-gray-400 text-center">يجب تجهيز كل أداة بالكمية المطلوبة قبل بدء اليوم</p>
      )}
    </section>
  );
}

function PrepRow({ item, prepared, onChange }: {
  item: PrepItem; prepared: number; onChange: (qty: number) => void;
}) {
  const covered = prepared >= (item.hasQuantity ? item.required : 1);

  // Presence-only fallback row (no auto-computed quantity): a simple tick.
  if (!item.hasQuantity) {
    return (
      <li>
        <button
          type="button"
          role="checkbox"
          aria-checked={covered}
          onClick={() => onChange(covered ? 0 : 1)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-start transition-all cursor-pointer ${
            covered ? "bg-emerald-50 border-emerald-100" : "bg-white border-gray-100 active:bg-gray-50"
          }`}
        >
          <span className={`w-5 h-5 rounded-md flex items-center justify-center border-2 flex-shrink-0 ${
            covered ? "bg-[#059669] border-[#059669]" : "bg-white border-gray-300"
          }`}>
            {covered && <CheckCircle2 size={14} className="text-white" aria-hidden="true" strokeWidth={3} />}
          </span>
          <span className={`text-sm flex-1 ${covered ? "text-emerald-700 font-medium" : "text-[#164E63]"}`}>{item.nameAr}</span>
        </button>
      </li>
    );
  }

  // Quantity row: required amount + a stepper for the prepared amount.
  return (
    <li className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${covered ? "bg-emerald-50/60 border-emerald-100" : "bg-white border-amber-200"}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#164E63] truncate">
          {item.nameAr}
          {!item.mustCover && <span className="ms-1.5 text-[10px] text-gray-400">(اختياري)</span>}
        </p>
        <p className="text-[11px] text-gray-500">
          المطلوب: <span className="lat font-semibold text-[#0E7490]">{item.required}</span> {item.unit}
          {!covered && <span className="text-red-500"> — أقل من المطلوب</span>}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => onChange(prepared - 1)}
          aria-label={`إنقاص ${item.nameAr}`}
          disabled={prepared <= 0}
          className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-[#164E63] cursor-pointer active:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          aria-label={`الكمية المجهّزة من ${item.nameAr}`}
          value={prepared}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className={`w-12 h-9 text-center rounded-lg border text-sm font-semibold outline-none focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/15 ${covered ? "border-emerald-200 text-emerald-700" : "border-amber-300 text-amber-700"}`}
        />
        <button
          type="button"
          onClick={() => onChange(prepared + 1)}
          aria-label={`زيادة ${item.nameAr}`}
          className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-[#164E63] cursor-pointer active:bg-gray-50"
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function NextVisitCard({ stop, onOpen }: { stop: NurseRouteStop; onOpen: () => void }) {
  const o = stop.order;
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-[#0891B2] text-white p-5 relative overflow-hidden"
      aria-labelledby="next-visit-title"
    >
      <div aria-hidden="true" className="absolute -bottom-8 -start-8 w-32 h-32 rounded-full bg-white/[0.07]" />
      <p className="text-[11px] font-medium text-cyan-200 uppercase tracking-wider mb-1">الزيارة التالية</p>
      <h2 id="next-visit-title" className="text-lg font-bold leading-snug">{o.patient.name}</h2>
      <p className="text-[11px] text-cyan-200 mb-3">
        <span className="lat ltr-tech">{customerOrderRef(o)}</span>
      </p>
      <ul className="space-y-1.5 mb-4 text-sm" role="list">
        <li className="flex items-center gap-2">
          <Clock size={14} className="text-cyan-200" aria-hidden="true" />
          <span>{getShiftLabel(o.shift)}</span>
        </li>
        <li className="flex items-start gap-2">
          <MapPin size={14} className="text-cyan-200 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span className="leading-snug">{nurseAddressDisplay(o.address)}</span>
        </li>
      </ul>
      <div className="flex gap-2">
        <button
          onClick={onOpen}
          className="flex-1 bg-white text-[#0E7490] font-semibold text-sm py-2.5 rounded-xl active:scale-[0.97] transition-transform cursor-pointer flex items-center justify-center gap-1.5"
        >
          عرض تفاصيل الموعد
          <ArrowLeft size={15} aria-hidden="true" />
        </button>
        <a
          href={`https://maps.google.com/?q=${o.address.lat},${o.address.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="فتح الخريطة"
          className="w-12 h-[44px] bg-white/15 backdrop-blur rounded-xl flex items-center justify-center active:scale-[0.97] transition-transform cursor-pointer"
        >
          <Navigation size={17} className="text-white" aria-hidden="true" />
        </a>
      </div>
    </motion.section>
  );
}

function DayDoneCard({ count }: { count: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl bg-emerald-50 border border-emerald-100 p-5 text-center"
    >
      <div className="w-12 h-12 rounded-full bg-emerald-100 mx-auto flex items-center justify-center mb-3">
        <CheckCircle2 size={22} className="text-emerald-700" aria-hidden="true" />
      </div>
      <h2 className="text-base font-bold text-emerald-800 mb-1">يومك جاهز</h2>
      <p className="text-xs text-emerald-700 leading-relaxed">
        أكملت {count} زيارة اليوم. شكراً لجهدك — راحة مستحقة.
      </p>
    </motion.section>
  );
}

function SummaryStat({ label, value, color, Icon }: { label: string; value: number; color: string; Icon: React.FC<{ size?: number; className?: string }> }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 text-center">
      <Icon size={16} className={`mx-auto mb-1 ${color}`} aria-hidden="true" />
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-500 leading-none">{label}</p>
    </div>
  );
}

function GameWidget({ game }: { game: NurseGamification }) {
  // Defensive: even though createStarterGame() always supplies a level +
  // empty badges array, guard against a partial mock row coming through.
  const level = game.level ?? { id: "lv-1", name: "مبتدئ", minPoints: 0, color: "#94A3B8" };
  const badges = game.badges ?? [];
  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3" aria-labelledby="game-title">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: level.color + "22" }}>
          <Trophy size={17} style={{ color: level.color }} aria-hidden="true" />
        </div>
        <div className="flex-1">
          <h2 id="game-title" className="text-sm font-bold text-[#164E63]">إنجازات اليوم</h2>
          <p className="text-[11px] text-gray-500">المستوى: {level.name}</p>
        </div>
        <div className="text-end">
          <p className="text-base font-bold text-[#164E63]">+{game.pointsToday ?? 0}</p>
          <p className="text-[10px] text-gray-400">نقطة اليوم</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MiniStat Icon={Star} label="إجمالي النقاط" value={(game.totalPoints ?? 0).toLocaleString("ar-u-nu-latn")} />
        <MiniStat Icon={Flame} label="الإستمرارية" value={`${game.streak ?? 0} يوم`} />
        <MiniStat Icon={BadgeCheck} label="الشارات" value={badges.length} />
      </div>

      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.slice(0, 4).map((b) => (
            <span key={b.id} className="text-[11px] bg-[#ECFEFF] text-[#0E7490] px-2 py-0.5 rounded-full font-medium">
              {b.name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function MiniStat({ Icon, label, value }: { Icon: React.FC<{ size?: number; className?: string }>; label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2 text-center">
      <Icon size={13} className="text-[#0891B2] mx-auto mb-1" aria-hidden="true" />
      <p className="text-sm font-bold text-[#164E63]">{value}</p>
      <p className="text-[10px] text-gray-500 leading-none">{label}</p>
    </div>
  );
}

// ────────────────────────────── Schedule ────────────────────────────────────

function NurseSchedule({ routes, stopsToday, onOpenStop, onMove }: {
  routes: { nurseId: string; date: string; stops: NurseRouteStop[] }[];
  stopsToday: NurseRouteStop[];
  onOpenStop: (s: NurseRouteStop) => void;
  // delta = -1 (up the list) or +1 (down). Date identifies which day's
  // override is being mutated. Caller persists in sessionStorage and bumps
  // a re-render version so the new order paints immediately.
  onMove: (date: string, orderId: string, delta: -1 | 1) => void;
}) {
  const totalAcrossDays = routes.reduce((acc, r) => acc + r.stops.length, 0) + (stopsToday.length > 0 && !routes.length ? stopsToday.length : 0);
  return (
    <div className="p-4 space-y-5">
      <header>
        <h1 className="text-lg font-bold text-[#164E63]">جدول الزيارات</h1>
        <p className="text-xs text-gray-500 mt-0.5">يمكنك إعادة ترتيب زياراتك يدوياً — الصباح أولاً ثم المساء.</p>
      </header>

      {totalAcrossDays === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
          <ListChecks size={28} className="text-gray-300 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-semibold text-[#164E63]">لا توجد زيارات مخصصة لك حالياً</p>
          <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">سيظهر هنا أي طلب يتم إسناده إليك من الإدارة.</p>
        </div>
      )}

      {routes.map((route, i) => {
        const isToday = i === 0;
        const visibleStops = isToday ? stopsToday : route.stops;
        return (
          <section key={route.date}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-[#164E63]">{formatDate(route.date)}</span>
              {isToday && (
                <span className="text-[11px] bg-[#ECFEFF] text-[#0E7490] px-2 py-0.5 rounded-full font-semibold">اليوم</span>
              )}
              <span className="text-[11px] text-gray-400">— {visibleStops.length} زيارة</span>
            </div>
            {visibleStops.length === 0 ? (
              <div className="bg-white rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-xs text-gray-400">
                لا توجد زيارات في هذا اليوم
              </div>
            ) : (
              <ul className="space-y-2" role="list">
                {visibleStops.map((s, idx) => (
                  <li key={s.orderId} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#ECFEFF] flex items-center justify-center flex-shrink-0 text-[#0891B2] text-xs font-bold">
                      {s.sequence}
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenStop(s)}
                      className="flex-1 min-w-0 text-start cursor-pointer"
                    >
                      <p className="text-sm font-semibold text-[#164E63] truncate">{s.order.patient.name}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5">
                        <Clock size={11} aria-hidden="true" />
                        {getShiftLabel(s.order.shift).split("(")[0].trim()}
                        <span className="mx-1">·</span>
                        <MapPin size={11} aria-hidden="true" />
                        <span className="truncate">{nurseAddressDisplay(s.order.address)}</span>
                      </p>
                    </button>
                    <SampleBadge order={s.order} />
                    <StopStatus status={s.status} />
                    {/* Manual reorder controls — disabled at the edges. */}
                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                      <button
                        type="button"
                        aria-label="نقل لأعلى"
                        disabled={idx === 0}
                        onClick={() => onMove(route.date, s.orderId, -1)}
                        className="w-7 h-6 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label="نقل لأسفل"
                        disabled={idx === visibleStops.length - 1}
                        onClick={() => onMove(route.date, s.orderId, 1)}
                        className="w-7 h-6 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                      >
                        ▼
                      </button>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 flex-shrink-0" aria-hidden="true" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SampleBadge({ order }: { order: Order }) {
  // Show the dominant sample type per order
  const types = new Set(order.items.map((i) => i.nameEn.toLowerCase().includes("urine") ? "urine" : "blood"));
  const isBlood = types.has("blood");
  return (
    <span className={`hidden sm:inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${
      isBlood ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"
    }`}>
      <Droplets size={10} aria-hidden="true" /> {isBlood ? "دم" : "بول"}
    </span>
  );
}

function StopStatus({ status }: { status: NurseRouteStop["status"] }) {
  const map = {
    pending:   { label: "معلّق",  cls: "bg-amber-50 text-amber-700" },
    completed: { label: "مكتمل",  cls: "bg-emerald-50 text-emerald-700" },
    failed:    { label: "متعذر",  cls: "bg-red-50 text-red-600" },
    skipped:   { label: "متجاهل", cls: "bg-gray-100 text-gray-500" },
  } as const;
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${map[status].cls}`}>{map[status].label}</span>;
}

// ────────────────────────────── Settings ────────────────────────────────────

function NurseSettings({ nurse, game, onLogout, isOnline, onToggleOnline }: {
  nurse: Nurse;
  game: NurseGamification;
  onLogout: () => void;
  isOnline: boolean;
  onToggleOnline: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(nurse.name);
  const [city, setCity] = useState(nurse.city);
  const [photoUrl, setPhotoUrl] = useState(nurse.photoUrl ?? "");

  const onPickFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setPhotoUrl(reader.result); };
    reader.readAsDataURL(file);
  };

  const dirty = name !== nurse.name || city !== nurse.city || (photoUrl || undefined) !== nurse.photoUrl;
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || !city.trim()) { toast.error("الاسم والمدينة مطلوبان"); return; }
    setSaving(true);
    try {
      // Phase 3.8 P1: real await + error toast. Previous version fired the
      // success toast regardless of whether the API call failed.
      const r = await updateNurseProfile(nurse.id, {
        name: name.trim(),
        city: city.trim(),
        photoUrl: photoUrl.trim() || undefined,
      });
      if (!r.ok) { toast.error(r.error ?? "تعذر حفظ الملف الشخصي"); return; }
      toast.success("تم الحفظ بنجاح");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Online / offline status — drives whether the prep checklist
         appears on the home tab. Persisted on `nurses.is_online`. */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-[#164E63]">وضع العمل</p>
          <p className="text-[12px] text-gray-500 mt-0.5">
            {isOnline ? "أنت في وضع العمل الآن" : "أنت غير نشط حالياً"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void onToggleOnline(); }}
          className={`text-[12px] font-semibold px-3 py-2 rounded-xl cursor-pointer ${
            isOnline ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {isOnline ? "إنهاء العمل" : "بدء العمل"}
        </button>
      </section>

      {/* Profile */}
      <header className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
        <div className="relative w-16 h-16 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
          {nurse.photoUrl && <Image src={nurse.photoUrl} alt={nurse.name} fill className="object-cover" sizes="64px" unoptimized />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-[#164E63] truncate">{nurse.name}</p>
          <p className="text-xs text-gray-500 lat" dir="ltr">{nurse.phone}</p>
          <p className="text-xs text-gray-500">{nurse.city}</p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="text-[11px] px-2.5 py-1 rounded-md bg-[#ECFEFF] text-[#0891B2] cursor-pointer font-semibold"
        >
          {editing ? "إغلاق" : "تعديل"}
        </button>
      </header>

      {editing && (
        <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
              {photoUrl
                ? <Image src={photoUrl} alt="" fill sizes="64px" className="object-cover" unoptimized />
                : <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">بلا صورة</div>
              }
            </div>
            <div className="flex-1 space-y-2">
              <label className="block text-[11px] font-medium text-gray-500">
                رفع صورة جديدة
                <input
                  type="file" accept="image/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); }}
                  className="block w-full mt-1 text-xs file:me-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#ECFEFF] file:text-[#0891B2] file:cursor-pointer"
                />
              </label>
              <input
                value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)}
                placeholder="أو الصق رابط صورة"
                className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs lat" dir="ltr"
              />
            </div>
          </div>

          <label className="block">
            <span className="text-[11px] font-medium text-gray-500">الاسم</span>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 h-11 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-gray-500">المدينة</span>
            <select
              value={city} onChange={(e) => setCity(e.target.value)}
              className="w-full mt-1 h-11 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer"
            >
              <option value="دمشق">دمشق</option>
              <option value="ريف دمشق">ريف دمشق</option>
            </select>
          </label>

          <p className="text-[11px] text-gray-400 leading-relaxed">
            رقم الهاتف وحالة التفعيل تُدار من قِبل الإدارة فقط.
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => { setName(nurse.name); setCity(nurse.city); setPhotoUrl(nurse.photoUrl ?? ""); setEditing(false); }}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#164E63] cursor-pointer"
            >إلغاء</button>
            <button
              disabled={!dirty || saving}
              onClick={save}
              className="flex-1 py-2.5 rounded-xl bg-[#0891B2] text-white text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >{saving ? "جاري الحفظ…" : "حفظ"}</button>
          </div>
        </section>
      )}

      {/* Level + Points hero */}
      {(() => {
        const lvl = game.level ?? { id: "lv-1", name: "مبتدئ", minPoints: 0, color: "#94A3B8" };
        return (
          <section
            className="rounded-2xl p-5 text-white relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${lvl.color}, ${lvl.color}cc)` }}
          >
            <div aria-hidden="true" className="absolute -top-6 -end-6 w-24 h-24 rounded-full bg-white/15" />
            <p className="text-[11px] uppercase tracking-wide opacity-90 mb-1">المستوى</p>
            <h2 className="text-xl font-bold mb-3">{lvl.name}</h2>
            <p className="text-3xl font-bold leading-none mb-1">{(game.totalPoints ?? 0).toLocaleString("ar-u-nu-latn")}</p>
            <p className="text-xs opacity-90">إجمالي النقاط</p>
          </section>
        );
      })()}

      {/* Stats grid */}
      <section className="grid grid-cols-2 gap-3">
        <StatTile Icon={CheckCircle2} label="زيارات مكتملة"   value={game.totalCompleted ?? 0} color="text-emerald-600" />
        <StatTile Icon={Target}       label="معدل النجاح"     value={`${game.successRate ?? 0}%`} color="text-[#0891B2]" />
        <StatTile Icon={XCircle}      label="فشل التحصيل"    value={game.failedCount ?? 0} color="text-red-500" />
        <StatTile Icon={Flame}        label="استمرارية"      value={`${game.streak ?? 0} يوم`} color="text-amber-600" />
        <StatTile Icon={TrendingUp}   label="نقاط الشهر"     value={game.monthlyPoints ?? 0} color="text-purple-600" />
        <StatTile Icon={ListChecks}   label="زيارات الشهر"   value={game.monthlyCompleted ?? 0} color="text-[#0E7490]" />
      </section>

      {/* Badges */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Award size={16} className="text-amber-500" aria-hidden="true" />
          <h3 className="text-sm font-bold text-[#164E63]">الشارات</h3>
          <span className="text-xs text-gray-400 ms-auto">{(game.badges ?? []).length} / {NURSE_BADGES.length}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {NURSE_BADGES.map((b) => {
            const earned = (game.badges ?? []).some((g) => g.id === b.id);
            return (
              <div key={b.id} className={`text-center p-3 rounded-xl border ${
                earned ? "bg-amber-50 border-amber-100" : "bg-gray-50 border-gray-100 opacity-50"
              }`}>
                <BadgeCheck size={20} className={`mx-auto mb-1 ${earned ? "text-amber-600" : "text-gray-300"}`} aria-hidden="true" />
                <p className="text-[11px] font-semibold text-[#164E63]">{b.name}</p>
                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{b.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      <button
        onClick={() => { onLogout(); toast.success("تم تسجيل الخروج"); }}
        className="w-full bg-red-50 border border-red-100 text-red-600 rounded-2xl py-3 text-sm font-semibold cursor-pointer active:bg-red-100"
      >
        تسجيل الخروج
      </button>
    </div>
  );
}

function StatTile({ Icon, label, value, color }: { Icon: React.FC<{ size?: number; className?: string }>; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <Icon size={16} className={`mb-1 ${color}`} aria-hidden="true" />
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-500 leading-none">{label}</p>
    </div>
  );
}

// ────────────────────────────── Notifications + Visit Detail ─────────────────

function NurseNotifList({ notifs, onRead }: { notifs: Notification[]; onRead: (id: string) => void }) {
  if (notifs.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-gray-400">لا توجد إشعارات</div>;
  }
  return (
    <ul className="px-4 py-2 space-y-2 pb-6 max-h-[60vh] overflow-y-auto" role="list">
      {notifs.map((n) => (
        <li key={n.id}>
          <button
            onClick={() => onRead(n.id)}
            className={`w-full text-start rounded-xl p-3 cursor-pointer transition-colors ${
              n.isRead ? "bg-white border border-gray-100" : "bg-[#ECFEFF] border border-[#0891B2]/20"
            }`}
          >
            <div className="flex items-start gap-2">
              <p className={`text-sm font-semibold flex-1 ${n.isRead ? "text-[#164E63]" : "text-[#0E7490]"}`}>{n.titleAr}</p>
              {!n.isRead && <span className="w-2 h-2 rounded-full bg-[#0891B2] mt-1.5 flex-shrink-0" />}
            </div>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{n.bodyAr}</p>
            <p className="text-[10px] text-gray-400 mt-1">{relativeTime(n.createdAt)}</p>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NurseVisitDetail({
  stop, nurseName, onBack, onSetOnTheWay, onSetArrived, onComplete, onFail, onVerifyPatient, onDeliveredToLab, onConfirmCash,
}: {
  stop: NurseRouteStop;
  nurseName: string;
  onBack: () => void;
  onSetOnTheWay: () => void;
  onSetArrived: () => void;
  onComplete: () => void;
  onFail: (reason: string) => void;
  onDeliveredToLab: () => void;
  onVerifyPatient: (officialName: string, nationalId: string, note?: string) => void;
  onConfirmCash: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const o = stop.order;
  const toast = useToast();
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState<string>("");
  const [verifyOpen, setVerifyOpen] = useState(false);
  // Verify form prefill: prior verification > saved patient national_id > blank.
  // The nurse never re-types the id when it's already on file.
  const [vName, setVName] = useState(o.patientVerification?.officialName ?? o.patient.name);
  const [vId, setVId] = useState(o.patientVerification?.nationalId ?? o.patient.nationalId ?? "");
  const [vNote, setVNote] = useState(o.patientVerification?.note ?? "");
  const verified = !!o.patientVerification;
  void nurseName; // currently unused — reserved for displaying the actor on the timeline.

  // Per-button loading flag prevents duplicate clicks. Soft-skip warns when
  // the nurse jumps a step (e.g. on_the_way → sample_collected without
  // arrived) — admin override pattern: warn, then allow.
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const status = o.status;

  const runAction = async (
    key: string,
    action: () => unknown,
    opts?: { successToast?: string },
  ) => {
    if (pendingAction) return;
    // Pre-flight: when Supabase persistence is on, refuse to act on a stop
    // that isn't bound to a real Supabase order. The user has to wait for
    // hydration or this stop genuinely has no real order behind it.
    if (USE_SUPABASE && o.id && !isUuid(o.id)) {
      toast.error("تعذر تحديث حالة الطلب، لم يتم العثور على الطلب الحقيقي");
      return;
    }
    setPendingAction(key);
    try {
      const result = await Promise.resolve(action());
      if (result && typeof result === "object" && "ok" in result && (result as { ok: boolean }).ok === false) {
        const err = (result as { error?: string }).error;
        toast.error(err && err.length > 0 ? err : "حدث خطأ، حاول مرة أخرى");
        return;
      }
      toast.success(opts?.successToast ?? "تم تحديث حالة الزيارة بنجاح");
    } catch {
      toast.error("حدث خطأ، حاول مرة أخرى");
    } finally {
      setPendingAction(null);
    }
  };

  const confirmSkip = (msg: string) => window.confirm(msg);

  const handleOnTheWay = () => runAction("on_the_way", onSetOnTheWay);

  const handleArrived = () => {
    if (status === "nurse_assigned" || status === "confirmed") {
      if (!confirmSkip("تخطّيت خطوة 'في الطريق'. هل تريد المتابعة؟")) return;
    }
    runAction("arrived", onSetArrived);
  };

  const handleComplete = () => {
    if (!verified) { toast.error("يجب التحقق من هوية المريض أولاً"); return; }
    // Phase 3.5 hardening: payment gate. Online orders must be paid; cash
    // orders must be collected before the sample. The server enforces the
    // online-paid rule too (set_order_status_admin), so this is a UX
    // shortcut, not the only line of defence.
    if (o.paymentMethod === "online" && o.paymentStatus !== "paid") {
      toast.error("لم يُؤكَّد الدفع بعد لهذا الطلب. لا يمكن أخذ العينة.");
      return;
    }
    if (o.paymentMethod === "cash" && o.paymentStatus !== "paid") {
      toast.error("اضغط 'تم استلام المبلغ' قبل تسجيل أخذ العينة.");
      return;
    }
    if (status !== "arrived") {
      if (!confirmSkip("لم تسجّل الوصول بعد. هل أنت متأكد من تسجيل أخذ العينة؟")) return;
    }
    runAction("collected", onComplete, { successToast: "تم تسجيل أخذ العينة" });
  };

  const handleDeliveredToLab = () => {
    if (status !== "sample_collected") {
      if (!confirmSkip("لم تسجّل أخذ العينة بعد. هل تريد المتابعة لتسليم المخبر؟")) return;
    }
    runAction("delivered", onDeliveredToLab, { successToast: "تم تسجيل تسليم العينة للمخبر" });
  };

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-0 z-40 bg-gray-50 flex flex-col max-w-md mx-auto"
      role="dialog"
      aria-modal="true"
      aria-label="تفاصيل الزيارة"
    >
      <header className="flex items-center gap-3 px-4 py-4 bg-white border-b border-gray-100">
        <BackButton onClick={onBack} />
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-[#164E63] truncate">تفاصيل الزيارة</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            <span className="lat ltr-tech">{customerOrderRef(o)}</span>
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-cta">
        {/* Patient */}
        <section className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-[11px] text-gray-400 mb-1 uppercase tracking-wide">المريض</p>
          <p className="text-base font-bold text-[#164E63]">{o.patient.name}</p>
          <div className="flex gap-2 mt-3">
            <a href="tel:+963911000000" className="flex items-center gap-2 bg-[#ECFEFF] px-3 py-2 rounded-xl cursor-pointer">
              <Phone size={15} className="text-[#0891B2]" aria-hidden="true" />
              <span className="text-sm font-medium text-[#0891B2]">اتصل</span>
            </a>
            <a
              href={`https://maps.google.com/?q=${o.address.lat},${o.address.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-emerald-50 px-3 py-2 rounded-xl cursor-pointer"
            >
              <Navigation size={15} className="text-[#059669]" aria-hidden="true" />
              <span className="text-sm font-medium text-[#059669]">خريطة</span>
            </a>
          </div>
        </section>

        {/* Address */}
        <section className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-[11px] text-gray-400 mb-1 uppercase tracking-wide">العنوان</p>
          <div className="flex items-start gap-2">
            <MapPin size={15} className="text-[#059669] mt-0.5 flex-shrink-0" aria-hidden="true" />
            <p className="text-sm font-medium text-[#164E63]">{o.address.description}</p>
          </div>
        </section>

        {/* Tests */}
        <section className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-[11px] text-gray-400 mb-2 uppercase tracking-wide">التحاليل</p>
          <ul className="space-y-1.5" role="list">
            {o.items.map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-sm text-[#164E63]">
                <Package size={14} className="text-[#0891B2]" aria-hidden="true" />
                {i.nameAr}
              </li>
            ))}
          </ul>
        </section>

        {/* Cash collection — only relevant for cash orders that haven't
           been collected yet. Online-paid orders show the paid badge
           instead. Amount comes straight from order.total (real DB value). */}
        <PaymentCollectionCard
          order={o}
          status={status}
          onConfirmCash={async () => {
            if (pendingAction) return;
            setPendingAction("collect_cash");
            try {
              const r = await onConfirmCash();
              if (!r.ok) {
                toast.error(r.error ?? "تعذر تأكيد التحصيل");
                return;
              }
              toast.success("تم تسجيل تحصيل المبلغ");
            } finally {
              setPendingAction(null);
            }
          }}
          collecting={pendingAction === "collect_cash"}
        />

        {/* Patient verification — disabled until the nurse marks "وصلت".
           Pre-arrival, the section renders an explanatory placeholder so
           the nurse can't open the verification sheet by accident. */}
        <section className={`bg-white rounded-2xl border border-gray-100 p-4 ${status !== "arrived" && !verified ? "opacity-70" : ""}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide">التحقق من المريض</p>
            {verified ? (
              <span className="text-[11px] font-semibold text-emerald-600 inline-flex items-center gap-1">
                <CheckCircle2 size={12} aria-hidden="true" />
                تم التحقق
              </span>
            ) : (
              <span className="text-[11px] text-amber-600">غير مُتحقَّق</span>
            )}
          </div>
          {verified ? (
            <div className="space-y-1">
              <p className="text-sm text-[#164E63]">{o.patientVerification?.officialName}</p>
              <p className="text-xs text-gray-500 lat" dir="ltr">{o.patientVerification?.nationalId}</p>
              {o.patientVerification?.note && <p className="text-xs text-gray-400">{o.patientVerification.note}</p>}
              {/* P5.2 — verification is append-only at the data layer
                  (mig 042). The nurse cannot edit a stamped identity;
                  the admin override path is admin-only. */}
              <p className="text-[11px] text-gray-400 leading-relaxed">
                التحقق مُستقَر — للتعديل تواصل مع الإدارة.
              </p>
            </div>
          ) : status === "arrived" ? (
            <Button variant="outline" size="sm" onClick={() => setVerifyOpen(true)}>
              <BadgeCheck size={14} aria-hidden="true" />
              تحقق من الهوية
            </Button>
          ) : (
            <p className="text-[11px] text-gray-500 leading-relaxed">
              يصبح التحقق من بيانات المريض متاحاً بعد تأكيد &quot;وصلت&quot;.
            </p>
          )}
        </section>

        {/* Aggregated, deduped customer instructions for this order */}
        <NurseInstructionsBlock order={o} />
      </div>

      {/* Actions — one dynamic primary CTA per order state, secondary "support"
         link, and a quiet "مشكلة؟" trigger that opens the failure sheet. The
         actual status APIs are unchanged. */}
      <footer className="bg-white border-t border-gray-100 px-4 pt-3 safe-bottom-md space-y-2">
        <NursePrimaryAction
          status={status}
          verified={verified}
          pendingAction={pendingAction}
          paymentReady={o.paymentStatus === "paid"}
          onOnTheWay={handleOnTheWay}
          onArrived={handleArrived}
          onVerify={() => setVerifyOpen(true)}
          onCollected={handleComplete}
          onDelivered={handleDeliveredToLab}
        />
        <div className="flex items-center justify-between">
          <SupportLink />
          <button
            type="button"
            onClick={() => setFailOpen(true)}
            disabled={!!pendingAction}
            className="text-[12px] font-medium text-gray-500 underline-offset-2 hover:underline disabled:opacity-50 cursor-pointer"
          >
            مشكلة؟
          </button>
        </div>
      </footer>

      {/* Verify patient sheet */}
      <BottomSheet open={verifyOpen} onClose={() => setVerifyOpen(false)} title="تحقق من هوية المريض">
        <div className="px-4 pb-4 space-y-3">
          <label className="block text-xs font-medium text-gray-500">
            الاسم في الهوية
            <input
              type="text" value={vName} onChange={(e) => setVName(e.target.value)}
              className="w-full mt-1 h-11 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none"
            />
          </label>
          <label className="block text-xs font-medium text-gray-500">
            الرقم الوطني
            <input
              type="text" value={vId} onChange={(e) => setVId(e.target.value)}
              className="w-full mt-1 h-11 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none lat"
              dir="ltr"
            />
          </label>
          <label className="block text-xs font-medium text-gray-500">
            ملاحظة (اختيارية)
            <textarea
              value={vNote} onChange={(e) => setVNote(e.target.value)} rows={2}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none resize-none"
            />
          </label>
          <Button
            variant="primary" size="lg" className="w-full"
            disabled={!vName.trim() || !vId.trim()}
            onClick={() => { onVerifyPatient(vName.trim(), vId.trim(), vNote.trim() || undefined); setVerifyOpen(false); }}
          >
            تأكيد التحقق
          </Button>
        </div>
      </BottomSheet>

      {/* Fail reason */}
      <BottomSheet open={failOpen} onClose={() => setFailOpen(false)} title="سبب تعذّر التحصيل">
        <div className="px-4 pb-4 space-y-2">
          {FAILED_COLLECTION_REASONS.map((r) => (
            <button
              key={r.value}
              onClick={() => setFailReason(r.value)}
              aria-pressed={failReason === r.value}
              className={`w-full flex items-center justify-between text-start p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                failReason === r.value ? "border-[#0891B2] bg-[#ECFEFF]" : "border-gray-200 active:bg-gray-50"
              }`}
            >
              <span className="text-sm text-[#164E63]">{r.labelAr}</span>
              <span className={`w-4 h-4 rounded-full border-2 ${failReason === r.value ? "border-[#0891B2] bg-[#0891B2]" : "border-gray-300"}`} />
            </button>
          ))}
          <Button
            variant="danger"
            size="lg"
            className="w-full"
            disabled={!failReason}
            onClick={() => {
              setFailOpen(false);
              runAction("failed", () => onFail(failReason), { successToast: "تم تسجيل تعذّر التحصيل" });
            }}
          >
            تأكيد
          </Button>
        </div>
      </BottomSheet>
    </motion.div>
  );
}

// One dynamic primary CTA whose label + action follow the order status.
// Rare/problem actions are intentionally NOT here; the footer surfaces them
// behind a quiet "مشكلة؟" link to keep this button as the only thing the
// nurse needs to read.
function NursePrimaryAction({
  status, verified, pendingAction, paymentReady,
  onOnTheWay, onArrived, onVerify, onCollected, onDelivered,
}: {
  status: Order["status"];
  verified: boolean;
  pendingAction: string | null;
  /** Phase 3.5: cash collected (or online paid) before sample. */
  paymentReady: boolean;
  onOnTheWay: () => void;
  onArrived: () => void;
  onVerify: () => void;
  onCollected: () => void;
  onDelivered: () => void;
}) {
  // After sample_collected the nurse usually delivers to the lab; once
  // delivered the order is read-only from the nurse's side.
  if (["sent_to_lab", "lab_processing", "result_ready", "completed", "cancelled", "lab_issue", "failed_to_collect"].includes(status)) {
    return (
      <div className="w-full text-center text-[13px] font-medium text-gray-400 bg-gray-50 rounded-xl py-3">
        لا يوجد إجراء مطلوب من الممرض الآن
      </div>
    );
  }
  if (status === "sample_collected") {
    return (
      <Button
        variant="primary" size="lg" className="w-full"
        loading={pendingAction === "delivered"}
        disabled={!!pendingAction && pendingAction !== "delivered"}
        onClick={onDelivered}
      >
        <Package size={16} aria-hidden="true" />
        تم تسليم العينة للمخبر
      </Button>
    );
  }
  if (status === "arrived") {
    if (!verified) {
      return (
        <Button
          variant="primary" size="lg" className="w-full"
          disabled={!!pendingAction}
          onClick={onVerify}
        >
          <BadgeCheck size={16} aria-hidden="true" />
          تأكيد بيانات المريض
        </Button>
      );
    }
    return (
      <div className="space-y-1.5">
        <Button
          variant="primary" size="lg" className="w-full"
          loading={pendingAction === "collected"}
          disabled={(!!pendingAction && pendingAction !== "collected") || !paymentReady}
          onClick={onCollected}
        >
          <CheckCircle2 size={16} aria-hidden="true" />
          تم أخذ العينة
        </Button>
        {!paymentReady && (
          <p className="text-[11px] text-amber-700 text-center">
            يجب تأكيد الدفع قبل أخذ العينة.
          </p>
        )}
      </div>
    );
  }
  if (status === "on_the_way") {
    return (
      <Button
        variant="primary" size="lg" className="w-full"
        loading={pendingAction === "arrived"}
        disabled={!!pendingAction && pendingAction !== "arrived"}
        onClick={onArrived}
      >
        <CheckCircle2 size={16} aria-hidden="true" />
        وصلت
      </Button>
    );
  }
  // pending / scheduled / confirmed / nurse_assigned → "أنا في الطريق"
  return (
    <Button
      variant="primary" size="lg" className="w-full"
      loading={pendingAction === "on_the_way"}
      disabled={!!pendingAction && pendingAction !== "on_the_way"}
      onClick={onOnTheWay}
    >
      <Navigation size={16} aria-hidden="true" />
      أنا في الطريق
    </Button>
  );
}

function SupportLink() {
  const settings = useSystemSettings();
  const raw = settings.whatsappNumber?.trim() ?? "";
  const digits = raw.replace(/[^\d+]/g, "");
  const href = digits ? `https://wa.me/${digits.replace(/^\+/, "")}` : "#";
  return (
    <a
      href={href}
      target={digits ? "_blank" : undefined}
      rel={digits ? "noopener noreferrer" : undefined}
      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#0891B2] cursor-pointer"
    >
      <Phone size={13} aria-hidden="true" />
      التواصل مع الدعم
    </a>
  );
}

// Cash-collection card. Shows the amount due and exposes a single
// "تم استلام المبلغ" CTA only when the order is cash + still pending. The
// nurse can collect any time after arriving on-site (before sample-
// collected gets harder), but we don't gate the workflow on this — the
// admin policy decides whether unpaid orders can advance further.
function PaymentCollectionCard({
  order, status, onConfirmCash, collecting,
}: {
  order: Order;
  status: Order["status"];
  onConfirmCash: () => void | Promise<void>;
  collecting: boolean;
}) {
  const isCash = order.paymentMethod === "cash";
  const isPaid = order.paymentStatus === "paid";

  if (!isCash) {
    return (
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-[11px] text-gray-400 mb-1 uppercase tracking-wide">الدفع</p>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#164E63]">مدفوع إلكترونياً</p>
          <span className="text-[11px] font-semibold text-emerald-600 inline-flex items-center gap-1">
            <CheckCircle2 size={12} aria-hidden="true" />
            مدفوع
          </span>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">{formatPrice(order.total)}</p>
      </section>
    );
  }

  if (isPaid) {
    return (
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-[11px] text-gray-400 mb-1 uppercase tracking-wide">الدفع</p>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#164E63]">تم تحصيل المبلغ نقداً</p>
          <span className="text-[11px] font-semibold text-emerald-600 inline-flex items-center gap-1">
            <CheckCircle2 size={12} aria-hidden="true" />
            تم التحصيل
          </span>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">{formatPrice(order.total)}</p>
      </section>
    );
  }

  // Cash + pending: nurse needs to collect BEFORE the sample (Phase 3.5).
  const enabled = status === "arrived";
  return (
    <section className="bg-emerald-50/60 rounded-2xl border border-emerald-100 p-4">
      <p className="text-[11px] text-emerald-700 font-semibold uppercase tracking-wide mb-1">
        تحصيل نقدي
      </p>
      <p className="text-[12px] text-[#164E63] leading-relaxed mb-3">
        المبلغ المطلوب تحصيله من العميل
      </p>
      <p className="text-2xl font-extrabold text-[#059669] mb-3 lat" dir="ltr">
        {formatPrice(order.total)}
      </p>
      <Button
        variant="primary"
        size="md"
        className="w-full"
        loading={collecting}
        disabled={!enabled || collecting}
        onClick={() => { void onConfirmCash(); }}
      >
        <CheckCircle2 size={14} aria-hidden="true" />
        تم استلام المبلغ
      </Button>
      {!enabled && (
        <p className="text-[11px] text-amber-700 mt-2">
          يصبح التحصيل متاحاً بعد تأكيد &quot;وصلت&quot;.
        </p>
      )}
    </section>
  );
}

// Aggregated, deduped customer instructions for an order — surfaced inside
// the nurse visit detail so the nurse can re-state them for the patient if
// needed.
function NurseInstructionsBlock({ order }: { order: Order }) {
  const list = instructionsForOrder(order);
  if (list.length === 0) return null;
  const structured = isStructuredInstructions(list);
  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-4">
      <p className="text-[11px] text-gray-400 mb-2 uppercase tracking-wide">تعليمات العميل</p>
      <ul className="space-y-2">
        {list.map((ins) => (
          <li key={ins.id} className="text-sm text-[#164E63] leading-relaxed">
            {structured ? (
              <>
                <p className="font-semibold">{(ins as TestInstruction).titleAr}</p>
                <p className="text-xs text-gray-500 mt-0.5">{(ins as TestInstruction).bodyAr}</p>
              </>
            ) : (
              <p>{(ins as Instruction).textAr}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Shortage request form ──────────────────────────────────────────────────
// Pre-start only. Multi-select tools from the library + qty + optional note.
// Submits via submitShortageRequest, which the admin "طلبات الأدوات" section
// reads through a live store.
function ShortageRequestForm({ nurseId, nurseName, date, onCancel, onSubmit }: {
  nurseId: string;
  nurseName: string;
  date: string;
  onCancel: () => void;
  // FINAL HARDENING: callback receives null + Arabic error when the server
  // rejected the submit. Caller must surface that to the nurse.
  onSubmit: (requestId: string | null, error?: string) => void;
}) {
  const tools = useLibraryTools().filter((t) => t.isActive);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const setQty = (toolId: string, qty: number) => {
    setPicks((p) => ({ ...p, [toolId]: Math.max(0, Math.floor(qty)) }));
  };
  const totalSelected = Object.values(picks).filter((q) => q > 0).length;

  const submit = async () => {
    if (totalSelected === 0) return;
    setSubmitting(true);
    const items = Object.entries(picks)
      .filter(([, qty]) => qty > 0)
      .map(([toolId, qty]) => {
        const cat = tools.find((t) => t.id === toolId);
        return { toolId, toolNameAr: cat?.nameAr, requestedQuantity: qty };
      });
    const r = await submitShortageRequest({
      nurseId, nurseName, date, note: note.trim() || undefined, items,
    });
    setSubmitting(false);
    if (!r.ok || !r.request) {
      onSubmit(null, r.error);
      return;
    }
    onSubmit(r.request.id);
  };

  return (
    <div className="px-4 pb-4 space-y-3">
      <p className="text-[11px] text-gray-500 leading-relaxed">
        اختر الأدوات المفقودة وأدخل الكمية المطلوبة. سيتم إرسال الطلب للإدارة فوراً.
      </p>
      <ul className="space-y-1.5 max-h-[40vh] overflow-y-auto">
        {tools.map((t) => {
          const qty = picks[t.id] ?? 0;
          return (
            <li key={t.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#164E63]">{t.nameAr}</p>
                <p className="text-[11px] text-gray-400">{t.unit}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setQty(t.id, qty - 1)}
                  disabled={qty === 0}
                  aria-label="نقصان"
                  className="w-8 h-8 rounded-lg bg-white border border-gray-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-[#164E63]"
                >−</button>
                <input
                  type="number" min={0} value={qty}
                  onChange={(e) => setQty(t.id, Number(e.target.value))}
                  className="w-12 h-8 text-center rounded-lg border border-gray-200 text-xs"
                />
                <button
                  onClick={() => setQty(t.id, qty + 1)}
                  aria-label="زيادة"
                  className="w-8 h-8 rounded-lg bg-white border border-gray-200 cursor-pointer text-[#164E63]"
                >+</button>
              </div>
            </li>
          );
        })}
      </ul>
      <label className="block text-xs font-medium text-gray-500">
        ملاحظة (اختيارية)
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder="أي تفاصيل تساعد الإدارة في التحضير"
          className="w-full mt-1 p-2 rounded-xl border border-gray-200 text-sm resize-none focus:border-[#0891B2] outline-none"
        />
      </label>
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#164E63] cursor-pointer">
          إلغاء
        </button>
        <button
          onClick={submit}
          disabled={totalSelected === 0 || submitting}
          className="flex-1 py-2.5 rounded-xl bg-[#0891B2] text-white text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "جارٍ الإرسال…" : `إرسال طلب (${totalSelected})`}
        </button>
      </div>
    </div>
  );
}
