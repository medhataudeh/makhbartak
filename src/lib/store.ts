"use client";
import { useSyncExternalStore } from "react";
import type {
  Order,
  OrderEvent,
  OrderEventType,
  Notification,
  NotificationType,
  LabIssue,
  OrderNote,
  OrderResultFile,
  OrderFileEvent,
  OrderStatus,
} from "./types";
import {
  MOCK_NURSE_NOTIFICATIONS,
} from "./mock-data";
import { USE_SUPABASE } from "./supabase/flags";
// Phases 1-3 retired the direct-RPC mutator path; Stage A retired
// assignNurseRemote (see persistAssignNurseViaApi). Every persist call
// now goes through the /api/orders/* server routes. The legacy
// orders-mutations.ts exports remain @deprecated for the future
// authenticated-browser flow but are no longer imported here.
import {
  apiCreateOrder, apiListOrdersForAdmin, apiListOrdersForCustomer, apiListOrdersForNurse,
  apiSetOrderStatus, apiUploadLabResultFile, apiArchiveLabResultFile, apiConfirmLabResults,
  apiAssignNurse, apiAssignLab,
  apiAddOrderNote, apiApplyCoupon, apiSetPaymentStatus, apiCancelOrder,
  apiRescheduleOrder, apiVerifyPatient, apiForceCompleteOrder,
} from "./orders-api";
import { isUuid } from "./supabase/uuid";
import type { AuthSession } from "./types";

// ─── Tiny pub-sub ────────────────────────────────────────────────────────────
// Single in-memory store so that admin / customer / nurse / lab views inside
// the same browser tab reflect each other immediately. When a real backend
// arrives, swap the read/write helpers for fetch + websocket — the hooks stay.

type Listener = () => void;
const listeners = new Set<Listener>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }

// Phase 2 production hardening: orders + customer notifications boot empty
// in every environment. The previous USE_SUPABASE-off branch was seeding
// MOCK_ORDERS / MOCK_NOTIFICATIONS into admin/customer views, which leaked
// SEED_NURSE_* / SEED_CUSTOMER_* identifiers into assignment flows and
// produced cascade FK errors. Real rows arrive via the hydrate helpers.
let _orders: Order[] = [];
let _notifications: Notification[] = [];
// Nurse inbox is its own mutable array. With Supabase on we start empty and
// fill from `hydrateNotificationsForNurse` so the UI never shows demo data.
// With the flag off we keep the prototype seed.
let _nurseNotifications: Notification[] = USE_SUPABASE ? [] : [...MOCK_NURSE_NOTIFICATIONS];
let _labIssues: LabIssue[] = [];

// ─── Supabase hydrate (read-only; flag-gated; no-op until auth lands) ───────
// Phase 1 superseded the legacy module-load hydrate (it relied on the anon
// browser client, which mock auth can't authenticate). Hydration now runs
// per-view via hydrateOrdersForCustomer / hydrateOrdersForAdmin below.

// ─── Snapshot getters ────────────────────────────────────────────────────────
export function getOrders() { return _orders; }
export function getOrder(id: string) { return _orders.find((o) => o.id === id) ?? null; }
export function getCustomerNotifications() { return _notifications; }
export function getNurseNotifications() { return _nurseNotifications; }
export function getLabIssuesFor(orderId: string) {
  return _labIssues.filter((i) => i.orderId === orderId);
}

// Resolve the current Order for a given idempotency key. After the server
// swaps the placeholder id for the canonical UUID, this still returns the
// same record — so callers tracking an order by idempotency key see the
// server-generated public_number as soon as the swap lands.
export function getOrderByIdempotencyKey(key: string): Order | null {
  const id = _idempotency.get(key);
  if (!id) return null;
  return _orders.find((o) => o.id === id) ?? null;
}

export function useOrderByIdempotencyKey(key: string | null): Order | null {
  return useSyncExternalStore(
    subscribe,
    () => (key ? getOrderByIdempotencyKey(key) : null),
    () => null,
  );
}

// ─── Phase 1 hydration: pull orders from /api/orders and merge into _orders.
// Server rows win on id collision; local-only mock rows (no Supabase id) are
// preserved alongside. Safe to call repeatedly; callers should debounce on
// mount.
export async function hydrateOrdersForCustomer(customerId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  const remote = await apiListOrdersForCustomer(customerId);
  if (!remote) return;
  mergeRemoteOrders(remote);
}

export async function hydrateOrdersForAdmin(): Promise<void> {
  if (!USE_SUPABASE) return;
  const remote = await apiListOrdersForAdmin();
  if (!remote) return;
  mergeRemoteOrders(remote);
}

export async function hydrateOrdersForNurse(nurseId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  // Phase 2 mock-auth fallback: nurse seed ids today are slugs ("nur-1"),
  // not UUIDs. The server route requires a UUID, so a slug-id call returns
  // null. Fall back to the admin list so the nurse can still see and act on
  // real Supabase orders during Phase 2 testing. When a future migration
  // replaces nurse slugs with UUIDs, this branch becomes the primary path.
  const remote = isUuid(nurseId)
    ? await apiListOrdersForNurse(nurseId)
    : await apiListOrdersForAdmin();
  if (!remote) return;
  mergeRemoteOrders(remote);
}

// Stage G: pull customer/nurse notifications from Supabase.
interface RawNotificationRow {
  id: string;
  recipient_id: string;
  type: string;
  title_ar: string;
  body_ar: string;
  order_id: string | null;
  is_read: boolean;
  created_at: string;
}

function mapNotificationRow(r: RawNotificationRow, userId: string): Notification {
  return {
    id: r.id,
    userId,
    type: r.type as Notification["type"],
    titleAr: r.title_ar,
    bodyAr: r.body_ar,
    orderId: r.order_id ?? undefined,
    isRead: !!r.is_read,
    createdAt: r.created_at,
  };
}

function mergeRemoteNotifications(rows: RawNotificationRow[], userId: string) {
  const mapped = rows.map((r) => mapNotificationRow(r, userId));
  const byId = new Map(_notifications.map((n) => [n.id, n]));
  for (const n of mapped) byId.set(n.id, n);
  _notifications = Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  emit();
}

function mergeRemoteNurseNotifications(rows: RawNotificationRow[], nurseId: string) {
  const mapped = rows.map((r) => mapNotificationRow(r, nurseId));
  const byId = new Map(_nurseNotifications.map((n) => [n.id, n]));
  for (const n of mapped) byId.set(n.id, n);
  _nurseNotifications = Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  emit();
}

export async function hydrateNotificationsForCustomer(customerId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(customerId)) return;
  try {
    const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/notifications`, { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    if (!body || !Array.isArray(body.notifications)) return;
    mergeRemoteNotifications(body.notifications as RawNotificationRow[], customerId);
  } catch (err) {
    console.warn("[api/customers/notifications] hydrate failed", err);
  }
}

export async function hydrateNotificationsForNurse(nurseId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(nurseId)) return;
  try {
    const res = await fetch(`/api/nurses/${encodeURIComponent(nurseId)}/notifications`, { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    if (!body || !Array.isArray(body.notifications)) return;
    // Nurse inbox is its own store (`_nurseNotifications`) so the nurse UI
    // doesn't see customer notifications. Read marks go through
    // `markNurseNotificationRead` below.
    mergeRemoteNurseNotifications(body.notifications as RawNotificationRow[], nurseId);
  } catch (err) {
    console.warn("[api/nurses/notifications] hydrate failed", err);
  }
}

async function persistNotificationReadViaApi(
  customerId: string,
  notificationId: string,
): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(customerId) || !isUuid(notificationId)) return;
  const session = (await import("./auth")).getStoredSession();
  if (!session) return;
  try {
    await fetch(`/api/customers/${encodeURIComponent(customerId)}/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: "POST",
    });
  } catch (err) {
    console.warn("[api/customers/notifications/read] failed", err);
  }
}

function mergeRemoteOrders(remote: Order[]) {
  if (remote.length === 0) return;
  const byId = new Map(_orders.map((o) => [o.id, o]));
  for (const r of remote) byId.set(r.id, { ...byId.get(r.id), ...r });
  _orders = Array.from(byId.values()).sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  emit();
}

// ─── Hooks ───────────────────────────────────────────────────────────────────
export function useOrders() {
  return useSyncExternalStore(subscribe, getOrders, getOrders);
}
export function useOrder(id: string) {
  return useSyncExternalStore(
    subscribe,
    () => getOrder(id),
    () => getOrder(id),
  );
}
export function useCustomerNotifications() {
  return useSyncExternalStore(subscribe, getCustomerNotifications, getCustomerNotifications);
}
export function useNurseNotifications() {
  return useSyncExternalStore(subscribe, getNurseNotifications, getNurseNotifications);
}

// ─── Mutations ───────────────────────────────────────────────────────────────
function mutateOrder(id: string, patch: (o: Order) => Order) {
  let changed = false;
  _orders = _orders.map((o) => {
    if (o.id !== id) return o;
    changed = true;
    return patch(o);
  });
  if (changed) emit();
}

function nextId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
}

// ─── Order creation (idempotent) ────────────────────────────────────────────
// In-memory dedupe keyed by an idempotency key passed by the caller. Same key
// returns the same Order on retry so duplicate clicks never create duplicate
// orders.
const _idempotency = new Map<string, string>(); // idempotencyKey → orderId

interface CreateOrderInput {
  idempotencyKey: string;
  userId: string;
  type: Order["type"];
  packageSnapshot?: Order["packageSnapshot"];
  packageNameAr?: string;
  items: Order["items"];
  subtotal: number;
  couponCode?: string;
  couponDiscount: number;
  total: number;
  shift: Order["shift"];
  visitDate: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  address: Order["address"];
  patient: Order["patient"];
  paymentMethod: Order["paymentMethod"];
  paymentStatus: Order["paymentStatus"];
  instructions: Order["instructions"];
  publicNumber: string;
  /** Cash + allowCashOrders → status starts at confirmed; otherwise created (= awaiting payment to the customer). */
  initialStatus: OrderStatus;
  /** Phase 1: required to write to Supabase via /api/orders. When omitted or
   *  not a customer session, the order stays local-only (mock mode). */
  session?: AuthSession;
}

export function createOrder(input: CreateOrderInput): Order {
  const existingId = _idempotency.get(input.idempotencyKey);
  if (existingId) {
    const existing = _orders.find((o) => o.id === existingId);
    if (existing) return existing;
  }

  const now = new Date().toISOString();
  const id = nextId("ord");
  const order: Order = {
    id,
    publicNumber: input.publicNumber,
    userId: input.userId,
    status: input.initialStatus,
    type: input.type,
    packageSnapshot: input.packageSnapshot,
    packageNameAr: input.packageNameAr,
    items: input.items,
    subtotal: input.subtotal,
    couponCode: input.couponCode,
    couponDiscount: input.couponDiscount,
    total: input.total,
    shift: input.shift,
    shiftStartTime: input.shiftStartTime,
    shiftEndTime: input.shiftEndTime,
    visitDate: input.visitDate,
    address: input.address,
    patient: input.patient,
    paymentMethod: input.paymentMethod,
    paymentStatus: input.paymentStatus,
    instructions: input.instructions,
    nurseId: undefined,
    labId: undefined,
    resultFiles: [],
    notes: [],
    issues: [],
    fileEvents: [],
    events: [
      { id: nextId("ev"), orderId: id, type: "created", actor: "customer", createdAt: now },
    ],
    createdAt: now,
    updatedAt: now,
  };

  _orders = [order, ..._orders];
  _idempotency.set(input.idempotencyKey, id);

  // Customer notification: order received.
  const initialNotifBody = input.initialStatus === "created" && input.paymentMethod === "online"
    ? "بانتظار تأكيد الدفع لبدء التحضير لزيارتك."
    : "نحن معك خطوة بخطوة. سنرسل لك إشعاراً عند تأكيد الموعد.";
  _notifications = [
    {
      id: nextId("n"),
      userId: input.userId,
      type: "order_confirmed",
      titleAr: "تم استلام طلبك",
      bodyAr: initialNotifBody,
      orderId: id,
      isRead: false,
      createdAt: now,
    },
    ..._notifications,
  ];

  emit();
  // Stage G: mirror notification to Supabase.
  void persistNotificationViaApi({
    recipientCustomerId: input.userId,
    type: "order_received",
    titleAr: "تم استلام طلبك",
    bodyAr: initialNotifBody,
  });
  // Background remote write — Phase 1 routes through /api/orders (server-side
  // service-role). The Promise is tracked by idempotencyKey so the caller
  // (cart confirm) can await full hydration before navigating to the success
  // screen, instead of showing success on a half-created remote order.
  _remoteOrderPromises.set(input.idempotencyKey, writeOrderRemote(order, input));
  return order;
}

const _remoteOrderPromises = new Map<string, Promise<{ ok: boolean; error?: string }>>();

export function awaitOrderRemote(idempotencyKey: string): Promise<{ ok: boolean; error?: string }> {
  return _remoteOrderPromises.get(idempotencyKey) ?? Promise.resolve({ ok: true });
}

async function writeOrderRemote(order: Order, input: CreateOrderInput): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!input.session || input.session.role !== "customer") return { ok: true };
  const result = await apiCreateOrder(input.idempotencyKey, {
    type: order.type,
    packageId: order.packageSnapshot?.packageId,
    packageSnapshot: order.packageSnapshot,
    items: order.items.map((i) => ({
      testId: i.testId, nameAr: i.nameAr, nameEn: i.nameEn, priceSnapshot: i.priceSnapshot,
    })),
    subtotal: order.subtotal,
    couponCode: order.couponCode,
    couponDiscount: order.couponDiscount,
    total: order.total,
    shift: order.shift,
    visitDate: order.visitDate,
    shiftStartTime: order.shiftStartTime,
    shiftEndTime: order.shiftEndTime,
    patientId: order.patient.id,
    addressId: order.address.id,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    initialStatus: order.status,
  });
  if ("error" in result) {
    console.warn("[api/orders] create failed; keeping local order", result.error);
    return { ok: false, error: result.error };
  }
  // Swap the in-memory placeholder id for the real Supabase UUID so subsequent
  // reads (refresh → hydrate) align without duplicates. The `created` server
  // payload also carries any server-defaulted fields (timestamps, etc.).
  if (result.orderId !== order.id) {
    _orders = _orders.map((o) => (o.id === order.id ? { ...result.order, instructions: order.instructions } : o));
    _idempotency.set(input.idempotencyKey, result.order.id);
    emit();
  }
  return { ok: true };
}

interface ActorRef { actor: OrderEvent["actor"]; actorName?: string }

// Stage G: mirror customer/nurse notifications into Supabase. Caller has
// already pushed the optimistic in-memory entry; this helper merely posts to
// /api/admin/notifications which resolves the recipient profile_id.
async function persistNotificationViaApi(payload: {
  recipientCustomerId?: string;
  recipientNurseId?: string;
  type: string;
  titleAr: string;
  bodyAr: string;
  orderId?: string;
}): Promise<void> {
  if (!USE_SUPABASE) return;
  const session = (await import("./auth")).getStoredSession();
  if (!session) return;
  try {
    await fetch("/api/admin/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[api/admin/notifications] failed", err);
  }
}

export function appendEvent(orderId: string, type: OrderEventType, ref: ActorRef, note?: string) {
  mutateOrder(orderId, (o) => ({
    ...o,
    events: [
      ...(o.events ?? []),
      {
        id: nextId("ev"),
        orderId,
        type,
        actor: ref.actor,
        actorName: ref.actorName,
        note,
        createdAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  }));
}

const STATUS_TO_EVENT: Partial<Record<OrderStatus, OrderEventType>> = {
  scheduled: "scheduled",
  confirmed: "confirmed",
  nurse_assigned: "nurse_assigned",
  on_the_way: "on_the_way",
  arrived: "arrived",
  sample_collected: "sample_collected",
  sent_to_lab: "sent_to_lab",
  lab_processing: "lab_processing",
  result_ready: "result_ready",
  completed: "completed",
  failed_to_collect: "failed_collection",
  lab_issue: "lab_issue_opened",
  cancelled: "cancelled",
};

export function setOrderStatus(orderId: string, status: OrderStatus, ref: ActorRef, note?: string): Promise<{ ok: boolean; error?: string }> {
  mutateOrder(orderId, (o) => ({ ...o, status, updatedAt: new Date().toISOString() }));
  const evt = STATUS_TO_EVENT[status];
  if (evt) appendEvent(orderId, evt, ref, note);
  // Phase 2: persist via /api/orders/[id]/status when flag on. The legacy
  // setOrderStatusRemote path is kept for the future authenticated-browser
  // flow but is no longer called.
  const remote = persistOrderStatusViaApi(orderId, status, note);
  // Customer notification mirror — only for milestones the user cares about.
  const notifMap: Partial<Record<OrderStatus, { type: NotificationType; titleAr: string; bodyAr: string }>> = {
    confirmed:        { type: "order_confirmed", titleAr: "تم تأكيد طلبك",    bodyAr: "تم تأكيد طلبك. سيصلك الممرض في الموعد." },
    nurse_assigned:   { type: "nurse_assigned",  titleAr: "تم تعيين الممرض", bodyAr: "تم تعيين الممرض لزيارتك." },
    on_the_way:       { type: "nurse_on_way",    titleAr: "الممرض في الطريق", bodyAr: "الممرض في طريقه إليك الآن." },
    sample_collected: { type: "sample_collected",titleAr: "تم أخذ العينة",   bodyAr: "تم أخذ العينة بنجاح." },
    completed:        { type: "result_ready",    titleAr: "اكتمل طلبك",       bodyAr: "اكتمل طلبك. النتيجة متاحة الآن داخل الطلب." },
  };
  const n = notifMap[status];
  if (n) {
    const order = getOrder(orderId);
    if (order) {
      _notifications = [
        {
          id: nextId("n"),
          userId: order.userId,
          type: n.type,
          titleAr: n.titleAr,
          bodyAr: n.bodyAr,
          orderId,
          isRead: false,
          createdAt: new Date().toISOString(),
        },
        ..._notifications,
      ];
      emit();
      // Stage G: mirror to Supabase. SQL notification_type doesn't include
      // every TS type — map the common cases; unsupported map to 'admin_note'.
      const sqlType =
        n.type === "order_confirmed"   ? "order_confirmed" :
        n.type === "nurse_assigned"    ? "nurse_assigned" :
        n.type === "nurse_on_way"      ? "nurse_on_way" :
        n.type === "sample_collected"  ? "sample_collected" :
        n.type === "result_ready"      ? "results_ready" :
        "admin_note";
      void persistNotificationViaApi({
        recipientCustomerId: order.userId,
        type: sqlType,
        titleAr: n.titleAr,
        bodyAr: n.bodyAr,
        orderId: isUuid(orderId) ? orderId : undefined,
      });
    }
  }
  return remote;
}

async function persistOrderStatusViaApi(
  orderId: string,
  status: OrderStatus,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  // Pre-flight: refuse to send a non-UUID to the API. Mock placeholder ids
  // (e.g. "ord-3") would otherwise return 400 from the server. The caller
  // should have resolved a real Supabase order before getting here; this
  // guard exists as defense-in-depth so a stale local id can't surface as
  // a successful UI toast.
  if (!isUuid(orderId)) {
    return {
      ok: false,
      error: "تعذر تحديث حالة الطلب، لم يتم العثور على الطلب الحقيقي",
    };
  }
  // Read the current mock session at write time so existing call sites
  // don't have to thread it through. Returns local-only when the session is
  // not a writer role (Phase 2 only allows nurse + admin).
  // Imported lazily-by-side-effect — auth lives in a "use client" file but
  // store.ts is also client-side, so direct import is fine.
  const session = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "nurse" && session.role !== "admin")) {
    return { ok: true };
  }
  const result = await apiSetOrderStatus(orderId, status, { note });
  if ("error" in result) {
    console.warn("[api/orders/status] failed; keeping local update", result.error);
    return { ok: false, error: result.error };
  }
  // Merge the canonical server row so updated_at, history-derived fields,
  // and any future server-only side-effects win over the optimistic patch.
  if (result.order) {
    const remote = result.order;
    _orders = _orders.map((o) => (o.id === remote.id ? { ...o, ...remote } : o));
    emit();
  }
  return { ok: true };
}

export function markNotificationRead(id: string) {
  let changed = false;
  let recipientUserId: string | null = null;
  _notifications = _notifications.map((n) => {
    if (n.id !== id || n.isRead) return n;
    changed = true;
    recipientUserId = n.userId;
    return { ...n, isRead: true };
  });
  if (changed) {
    emit();
    // Stage G: mirror the read flag to Supabase. The recipientUserId stored
    // on the notification row is the customer UUID (Phase 1 seed swap).
    if (recipientUserId) void persistNotificationReadViaApi(recipientUserId, id);
  }
}

export function markAllNotificationsRead() {
  if (_notifications.every((n) => n.isRead)) return;
  _notifications = _notifications.map((n) => ({ ...n, isRead: true }));
  emit();
}

// Nurse-side counterpart of markNotificationRead. Optimistic local flip,
// then persist via the new /api/nurses/[id]/notifications/[nid]/read route.
export function markNurseNotificationRead(id: string, nurseId: string) {
  let changed = false;
  _nurseNotifications = _nurseNotifications.map((n) => {
    if (n.id !== id || n.isRead) return n;
    changed = true;
    return { ...n, isRead: true };
  });
  if (changed) {
    emit();
    if (USE_SUPABASE && isUuid(nurseId) && isUuid(id)) {
      void fetch(`/api/nurses/${encodeURIComponent(nurseId)}/notifications/${encodeURIComponent(id)}/read`, {
        method: "POST",
      }).catch((err) => console.warn("[api/nurses/notifications/read] failed", err));
    }
  }
}

export function applyCoupon(orderId: string, code: string, discount: number, ref: ActorRef): Promise<{ ok: boolean; error?: string }> {
  let nextTotal = 0;
  mutateOrder(orderId, (o) => {
    nextTotal = Math.max(0, o.subtotal - discount);
    return {
      ...o,
      couponCode: code,
      couponDiscount: discount,
      total: nextTotal,
      updatedAt: new Date().toISOString(),
    };
  });
  appendEvent(orderId, "coupon_applied", ref, `${code} (-${discount})`);
  return persistOrderActionViaApi(orderId, async () =>
    apiApplyCoupon(orderId, code || null, discount, nextTotal),
  );
}

export function setPaymentStatus(orderId: string, status: Order["paymentStatus"], ref: ActorRef): Promise<{ ok: boolean; error?: string }> {
  mutateOrder(orderId, (o) => ({ ...o, paymentStatus: status, updatedAt: new Date().toISOString() }));
  appendEvent(orderId, "payment_status_changed", ref, status);
  return persistOrderActionViaApi(orderId, async () =>
    apiSetPaymentStatus(orderId, status as "pending" | "paid" | "failed" | "refunded"),
  );
}

export function addNote(orderId: string, note: Omit<OrderNote, "id" | "orderId" | "createdAt">): Promise<{ ok: boolean; error?: string }> {
  const full: OrderNote = {
    ...note,
    id: nextId("nt"),
    orderId,
    createdAt: new Date().toISOString(),
  };
  mutateOrder(orderId, (o) => ({ ...o, notes: [...(o.notes ?? []), full] }));
  appendEvent(orderId, "note_added", { actor: note.authorRole === "nurse" ? "nurse" : note.authorRole === "lab" ? "lab" : "admin", actorName: note.authorName });
  return persistOrderActionViaApi(orderId, async () =>
    apiAddOrderNote(orderId, note.text),
  );
}

// ─── Result files (lifecycle: upload → archive/replace → restore) ──────────
// Files are never permanently deleted. Archiving sets isActive=false and
// records a OrderFileEvent. Replace uploads a new file and archives the old
// one in one shot. Customer reads only active files; admin sees archived too.

function appendFileEvent(orderId: string, ev: Omit<OrderFileEvent, "id" | "orderId" | "createdAt">) {
  const full: OrderFileEvent = {
    ...ev,
    id: nextId("fe"),
    orderId,
    createdAt: new Date().toISOString(),
  };
  mutateOrder(orderId, (o) => ({
    ...o,
    fileEvents: [...(o.fileEvents ?? []), full],
  }));
}

interface UploadInput {
  labId: string;
  /** Used for the optimistic local preview. When the actual binary is also
   *  available (Phase 3 flag-on), pass `blob` so the API route can stream
   *  it to Supabase Storage. */
  fileUrl: string;
  blob?: File;
  fileName: string;
  uploadedBy: string;
  note?: string;
  /** When set, archive that file id and link the new one back to it. */
  replacesFileId?: string;
}

export function uploadResultFile(orderId: string, file: UploadInput): Promise<{ ok: boolean; error?: string }> {
  const localId = nextId("rf");
  const full: OrderResultFile = {
    id: localId,
    orderId,
    labId: file.labId,
    fileUrl: file.fileUrl,
    fileName: file.fileName,
    uploadedBy: file.uploadedBy,
    note: file.note,
    uploadedAt: new Date().toISOString(),
    isActive: true,
  };
  mutateOrder(orderId, (o) => {
    let files = o.resultFiles ?? [];
    if (file.replacesFileId) {
      files = files.map((f) => f.id === file.replacesFileId
        ? { ...f, isActive: false, archivedAt: new Date().toISOString(), archivedBy: file.uploadedBy, replacedById: full.id }
        : f);
    }
    return { ...o, resultFiles: [...files, full] };
  });
  appendFileEvent(orderId, {
    fileId: full.id, fileName: full.fileName,
    type: file.replacesFileId ? "replaced" : "uploaded",
    actor: "lab", actorName: file.uploadedBy, note: file.note,
  });
  appendEvent(orderId, "result_uploaded", { actor: "lab", actorName: file.uploadedBy }, file.fileName);
  return persistUploadViaApi(orderId, file, localId);
}

async function persistUploadViaApi(
  orderId: string,
  file: UploadInput,
  localFileId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(orderId)) {
    return { ok: false, error: "تعذر رفع الملف، الطلب غير موجود في قاعدة البيانات" };
  }
  if (!file.blob) {
    return { ok: false, error: "no_file_blob" };
  }
  const session = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "lab" && session.role !== "admin")) return { ok: true };

  // Translate the local placeholder replacesFileId (slug like rf-...) to the
  // real Supabase uuid when possible; otherwise pass undefined and let the
  // server treat this as a fresh upload.
  const replacesId = file.replacesFileId && isUuid(file.replacesFileId)
    ? file.replacesFileId
    : undefined;

  const result = await apiUploadLabResultFile(orderId, file.blob, {
    fileName: file.fileName, replacesFileId: replacesId, note: file.note,
  });
  if ("error" in result) {
    console.warn("[api/orders/lab/files] upload failed; keeping local row", result.error);
    return { ok: false, error: result.error };
  }
  if (result.order) {
    // Merge canonical row in. Drop the local placeholder we inserted by
    // matching on the locally-generated id; the server now owns the row.
    const remote = result.order;
    _orders = _orders.map((o) => {
      if (o.id !== remote.id) return o;
      const filtered = (o.resultFiles ?? []).filter((f) => f.id !== localFileId);
      return { ...o, ...remote, resultFiles: remote.resultFiles ?? filtered };
    });
    emit();
  }
  return { ok: true };
}

export function archiveResultFile(orderId: string, fileId: string, actor: { actor: "lab" | "admin"; actorName: string }, note?: string): Promise<{ ok: boolean; error?: string }> {
  let archived: OrderResultFile | undefined;
  mutateOrder(orderId, (o) => ({
    ...o,
    resultFiles: (o.resultFiles ?? []).map((f) => {
      if (f.id !== fileId) return f;
      archived = f;
      return { ...f, isActive: false, archivedAt: new Date().toISOString(), archivedBy: actor.actorName };
    }),
  }));
  if (archived) {
    appendFileEvent(orderId, {
      fileId, fileName: archived.fileName, type: "archived", actor: actor.actor, actorName: actor.actorName, note,
    });
  }
  return persistArchiveViaApi(orderId, fileId, note);
}

async function persistArchiveViaApi(
  orderId: string,
  fileId: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(orderId) || !isUuid(fileId)) {
    return { ok: false, error: "تعذر أرشفة الملف، السجل غير موجود في قاعدة البيانات" };
  }
  const session = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "lab" && session.role !== "admin")) return { ok: true };
  const result = await apiArchiveLabResultFile(orderId, fileId, note);
  if ("error" in result) {
    console.warn("[api/orders/lab/files/archive] failed; keeping local archive", result.error);
    return { ok: false, error: result.error };
  }
  if (result.order) {
    const remote = result.order;
    _orders = _orders.map((o) => (o.id === remote.id ? { ...o, ...remote } : o));
    emit();
  }
  return { ok: true };
}

/** Restore a previously archived file. */
export function restoreResultFile(orderId: string, fileId: string, actor: { actor: "lab" | "admin"; actorName: string }) {
  let restored: OrderResultFile | undefined;
  mutateOrder(orderId, (o) => ({
    ...o,
    resultFiles: (o.resultFiles ?? []).map((f) => {
      if (f.id !== fileId) return f;
      restored = f;
      return { ...f, isActive: true, archivedAt: undefined, archivedBy: undefined };
    }),
  }));
  if (restored) {
    appendFileEvent(orderId, {
      fileId, fileName: restored.fileName, type: "restored", actor: actor.actor, actorName: actor.actorName,
    });
  }
}

/** @deprecated kept for compatibility with older call sites. Prefer archiveResultFile. */
export function deleteResultFile(orderId: string, fileId: string) {
  archiveResultFile(orderId, fileId, { actor: "lab", actorName: "—" });
}

// ─── Result confirmation → auto-complete ───────────────────────────────────
// Lab clicks "تأكيد إرسال النتائج" once at least one active file exists.
// The order flips straight to `completed`. The customer sees "مكتمل" with the
// PDFs as the dominant element. There is no separate result_ready bucket on
// the customer side.
export function confirmResultsReady(orderId: string, ref: ActorRef): boolean {
  const order = getOrder(orderId);
  if (!order) return false;
  const hasActive = (order.resultFiles ?? []).some((f) => f.isActive);
  if (!hasActive) return false;
  // Local optimistic state flip — this also fires the Phase-2 status route
  // path internally for the order.status update.
  setOrderStatus(orderId, "completed", ref, "تأكيد إرسال النتائج");
  // Phase 3: also call the lab-confirm route so the server insists on at
  // least one active row in lab_result_files (defense-in-depth) and stamps
  // a uniform actor_role='lab' history row, independent of which mock
  // session called setOrderStatus.
  void persistConfirmViaApi(orderId);
  return true;
}

async function persistConfirmViaApi(orderId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(orderId)) return;
  const session = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "lab" && session.role !== "admin")) return;
  const result = await apiConfirmLabResults(orderId);
  if ("error" in result) {
    console.warn("[api/orders/lab/confirm] failed; status update may not be canonical", result.error);
    return;
  }
  if (result.order) {
    const remote = result.order;
    _orders = _orders.map((o) => (o.id === remote.id ? { ...o, ...remote } : o));
    emit();
  }
}

/** Admin override — close an order without uploaded results. Logged. */
export function forceCompleteOrder(orderId: string, ref: ActorRef, reason: string): Promise<{ ok: boolean; error?: string }> {
  // Optimistic local flip — also fires Phase-2 status persistence; the
  // server-side force_complete_order_admin call below stamps a canonical
  // history row with note='force:<reason>', overriding the generic note
  // produced by setOrderStatus.
  void setOrderStatus(orderId, "completed", ref, `إغلاق دون نتائج: ${reason}`);
  return persistOrderActionViaApi(orderId, async () =>
    apiForceCompleteOrder(orderId, reason),
  );
}

export function openLabIssue(issue: Omit<LabIssue, "id" | "createdAt" | "status">): Promise<{ ok: boolean; error?: string }> {
  const full: LabIssue = {
    ...issue,
    id: nextId("li"),
    createdAt: new Date().toISOString(),
    status: "open",
  };
  _labIssues = [..._labIssues, full];
  const order = getOrder(issue.orderId);
  mutateOrder(issue.orderId, (o) => ({
    ...o,
    status: "lab_issue",
    issues: [...(o.issues ?? []), full],
    updatedAt: new Date().toISOString(),
  }));
  appendEvent(issue.orderId, "lab_issue_opened", { actor: issue.createdByRole, actorName: issue.createdBy }, issue.description);
  if (order) {
    const msg = full.customerMessageAr
      ?? "حدثت مشكلة في العينة، وسيتم التواصل معك من فريق الدعم.";
    _notifications = [
      {
        id: nextId("n"),
        userId: order.userId,
        type: "lab_issue",
        titleAr: "تحديث على طلبك",
        bodyAr: msg,
        orderId: order.id,
        isRead: false,
        createdAt: new Date().toISOString(),
      },
      ..._notifications,
    ];
    emit();
    // Stage G: mirror to Supabase.
    void persistNotificationViaApi({
      recipientCustomerId: order.userId,
      type: "lab_issue",
      titleAr: "تحديث على طلبك",
      bodyAr: msg,
      orderId: isUuid(order.id) ? order.id : undefined,
    });
  }
  return persistOpenLabIssueViaApi(issue);
}

async function persistOpenLabIssueViaApi(
  issue: Omit<LabIssue, "id" | "createdAt" | "status">,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(issue.orderId)) {
    return { ok: false, error: "تعذر فتح المشكلة، الطلب غير موجود في قاعدة البيانات" };
  }
  const session = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "lab" && session.role !== "admin")) return { ok: true };
  const { apiOpenLabIssue } = await import("./lab-api");
  const result = await apiOpenLabIssue(issue.orderId, {
    type: issue.type,
    description: issue.description,
    customerMessageAr: issue.customerMessageAr,
  });
  if ("error" in result) {
    console.warn("[api/orders/lab-issues] failed; keeping local issue", result.error);
    return { ok: false, error: result.error };
  }
  if (result.order) {
    const remote = result.order;
    _orders = _orders.map((o) => (o.id === remote.id ? { ...o, ...remote } : o));
    emit();
  }
  return { ok: true };
}

export function updateLabIssueCustomerMessage(issueId: string, customerMessageAr: string): Promise<{ ok: boolean; error?: string }> {
  let orderId: string | null = null;
  _labIssues = _labIssues.map((i) => {
    if (i.id !== issueId) return i;
    orderId = i.orderId;
    return { ...i, customerMessageAr };
  });
  if (orderId) {
    mutateOrder(orderId, (o) => ({
      ...o,
      issues: (o.issues ?? []).map((i) => i.id === issueId ? { ...i, customerMessageAr } : i),
    }));
  }
  emit();
  return persistUpdateLabIssueMessageViaApi(issueId, customerMessageAr);
}

async function persistUpdateLabIssueMessageViaApi(
  issueId: string,
  customerMessageAr: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(issueId)) return { ok: true };
  const session = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return { ok: true };
  const { apiUpdateLabIssueMessage } = await import("./lab-api");
  return apiUpdateLabIssueMessage(issueId, customerMessageAr);
}

export function resolveLabIssue(issueId: string, note: string, ref: ActorRef): Promise<{ ok: boolean; error?: string }> {
  let orderId: string | null = null;
  _labIssues = _labIssues.map((i) => {
    if (i.id !== issueId) return i;
    orderId = i.orderId;
    return { ...i, status: "resolved", resolvedAt: new Date().toISOString(), resolutionNote: note };
  });
  if (orderId) appendEvent(orderId, "lab_issue_resolved", ref, note);
  emit();
  return persistResolveLabIssueViaApi(issueId, note);
}

async function persistResolveLabIssueViaApi(
  issueId: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(issueId)) return { ok: true };
  const session = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "admin" && session.role !== "lab")) return { ok: true };
  const { apiResolveLabIssue } = await import("./lab-api");
  return apiResolveLabIssue(issueId, note);
}

export function assignNurse(orderId: string, nurseId: string, ref: ActorRef): Promise<{ ok: boolean; error?: string }> {
  mutateOrder(orderId, (o) => ({ ...o, nurseId, status: o.status === "confirmed" ? "nurse_assigned" : o.status }));
  appendEvent(orderId, "nurse_assigned", ref, nurseId);
  return persistAssignNurseViaApi(orderId, nurseId);
}

export function assignLab(orderId: string, labId: string, ref: ActorRef): Promise<{ ok: boolean; error?: string }> {
  mutateOrder(orderId, (o) => ({ ...o, labId, updatedAt: new Date().toISOString() }));
  appendEvent(orderId, "sent_to_lab", ref, labId);
  return persistAssignLabViaApi(orderId, labId);
}

async function persistAssignNurseViaApi(
  orderId: string,
  nurseId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(orderId) || !isUuid(nurseId)) {
    return { ok: false, error: "تعذر تعيين الممرض، السجل غير موجود في قاعدة البيانات" };
  }
  const session = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return { ok: true };
  const result = await apiAssignNurse(orderId, nurseId);
  if ("error" in result) {
    console.warn("[api/orders/assign-nurse] failed; keeping local assignment", result.error);
    return { ok: false, error: result.error };
  }
  if (result.order) {
    const remote = result.order;
    _orders = _orders.map((o) => (o.id === remote.id ? { ...o, ...remote } : o));
    emit();
  }
  return { ok: true };
}

async function persistAssignLabViaApi(
  orderId: string,
  labId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(orderId) || !isUuid(labId)) {
    return { ok: false, error: "تعذر تعيين المخبر، السجل غير موجود في قاعدة البيانات" };
  }
  const session = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return { ok: true };
  const result = await apiAssignLab(orderId, labId);
  if ("error" in result) {
    console.warn("[api/orders/assign-lab] failed; keeping local assignment", result.error);
    return { ok: false, error: result.error };
  }
  if (result.order) {
    const remote = result.order;
    _orders = _orders.map((o) => (o.id === remote.id ? { ...o, ...remote } : o));
    emit();
  }
  return { ok: true };
}

// Shared persistence helper for the Stage B order-action mutators (note,
// coupon, payment status, cancel, reschedule, verify, force-complete). Each
// caller passes a `call` that targets the right /api/orders/[id]/* route;
// the helper handles flag/auth checks and merges the canonical row back
// into the store. Mock-only mode (flag off) returns `{ ok: true }` so
// callers don't have to special-case it.
type ActionApiResult = { order: import("./types").Order | null } | { error: string };
async function persistOrderActionViaApi(
  orderId: string,
  call: () => Promise<ActionApiResult>,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(orderId)) {
    return { ok: false, error: "تعذر حفظ التغيير، الطلب غير موجود في قاعدة البيانات" };
  }
  const session = (await import("./auth")).getStoredSession();
  // Phase-2 status route already runs from setOrderStatus when nurse triggers
  // verifyPatient etc.; here we accept admin + nurse so verifyPatient stays
  // valid for the field flow.
  if (!session || (session.role !== "admin" && session.role !== "nurse" && session.role !== "lab")) {
    return { ok: true };
  }
  const result = await call();
  if ("error" in result) {
    console.warn("[api/orders/<action>] failed; keeping local change", result.error);
    return { ok: false, error: result.error };
  }
  if (result.order) {
    const remote = result.order;
    _orders = _orders.map((o) => (o.id === remote.id ? { ...o, ...remote } : o));
    emit();
  }
  return { ok: true };
}

export function cancelOrder(orderId: string, ref: ActorRef, reason?: string): Promise<{ ok: boolean; error?: string }> {
  mutateOrder(orderId, (o) => ({ ...o, status: "cancelled", updatedAt: new Date().toISOString() }));
  appendEvent(orderId, "cancelled", ref, reason);
  return persistOrderActionViaApi(orderId, async () =>
    apiCancelOrder(orderId, reason),
  );
}

export function rescheduleOrder(orderId: string, visitDate: string, shift: Order["shift"], ref: ActorRef): Promise<{ ok: boolean; error?: string }> {
  mutateOrder(orderId, (o) => ({ ...o, visitDate, shift, updatedAt: new Date().toISOString() }));
  appendEvent(orderId, "rescheduled", ref, `${visitDate} / ${shift}`);
  return persistOrderActionViaApi(orderId, async () =>
    apiRescheduleOrder(orderId, visitDate, shift),
  );
}

export function verifyPatient(
  orderId: string,
  verification: { officialName: string; nationalId: string; note?: string },
  ref: ActorRef,
): Promise<{ ok: boolean; error?: string }> {
  mutateOrder(orderId, (o) => ({
    ...o,
    patientVerification: { orderId, ...verification },
    updatedAt: new Date().toISOString(),
  }));
  appendEvent(orderId, "note_added", ref, `تحقق من المريض: ${verification.officialName} / ${verification.nationalId}`);
  return persistOrderActionViaApi(orderId, async () =>
    apiVerifyPatient(orderId, verification.officialName, verification.nationalId, verification.note),
  );
}
