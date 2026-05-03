import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Order, OrderItem, OrderEvent, OrderResultFile, Address, Patient,
  Shift, PaymentMethod, OrderEventType,
} from "@/lib/types";
import { isUuid } from "@/lib/supabase/uuid";
import { sqlStatusToTs } from "@/lib/supabase/order-status";

// Reads the current customer's orders with the joined rows the UI expects:
//   orders + order_items + order_status_history + lab_result_files + addresses + patients
//
// Returns null on error so the caller falls back to the legacy local store.
//
// We map snake_case → camelCase here so the rest of the UI sees the same
// `Order` shape it always has.
const ORDER_SELECT = `
  id, public_number, customer_id, kind, status,
  visit_date, shift, shift_start_time, shift_end_time,
  subtotal, coupon_code, coupon_discount, total,
  payment_method, payment_status,
  nurse_id, lab_id, internal_notes, failed_reason,
  patient_official_name, patient_national_id,
  package_snapshot, created_at, updated_at,
  address:addresses ( id, customer_id, label, description, city, lat, lng, is_default ),
  patient:patients ( id, customer_id, name, national_id, note, is_default ),
  items:order_items ( id, lab_test_id, name_ar_snapshot, name_en_snapshot, price_snapshot, display_order ),
  events:order_status_history ( id, status, actor_role, actor_name, note, created_at ),
  result_files:lab_result_files ( id, storage_path, file_name, mime_type, size_bytes, status, uploaded_at, archived_at ),
  issues:lab_issues ( id, lab_id, type, description, customer_message_ar, status, created_by_role, created_at, resolved_at, resolution_note )
`;
// `created_by_name` / `resolved_by_name` were added in migration 017 with
// `create table if not exists`, so on databases that were already created by
// migration 002 those columns don't exist and PostgREST 400s the whole embed.
// We never reach for them in mapRowToOrder (it falls back to "—"), so the
// safest fix is to drop them from the projection.

// Minimal fallback select — used when the full embedded select errors (e.g.
// missing optional table on staging). Returns enough data to render the
// success screen + customer order list without exposing nulls.
const ORDER_SELECT_BARE = `
  id, public_number, customer_id, kind, status,
  visit_date, shift, shift_start_time, shift_end_time,
  subtotal, coupon_code, coupon_discount, total,
  payment_method, payment_status,
  nurse_id, lab_id, internal_notes, failed_reason,
  patient_official_name, patient_national_id,
  package_snapshot, created_at, updated_at,
  patient_id, address_id
`;

// Try the full embedded select; on failure (typically a missing optional
// column on staging), log the actual Postgres error and fall back to the bare
// row list, hydrating each row through fetchOrderById which has its own
// per-row fallback. This guarantees admin/customer/nurse list endpoints don't
// silently return empty just because one embed column is wrong.
async function listOrdersHydrated(
  sb: SupabaseClient,
  filter: { customerId?: string; nurseId?: string },
  scope: string,
): Promise<Order[] | null> {
  const fullQ = sb.from("orders").select(ORDER_SELECT).is("deleted_at", null);
  const full = await (
    filter.customerId ? fullQ.eq("customer_id", filter.customerId)
    : filter.nurseId  ? fullQ.eq("nurse_id", filter.nurseId)
    : fullQ
  ).order("created_at", { ascending: false });
  if (!full.error && full.data) {
    return (full.data as unknown as RawOrderRow[]).map(mapRowToOrder);
  }
  console.error(`[supabase] ${scope} embed failed; falling back to bare list`, {
    code: full.error?.code, message: full.error?.message,
    details: full.error?.details, hint: full.error?.hint,
  });
  const bareQ = sb.from("orders").select(ORDER_SELECT_BARE).is("deleted_at", null);
  const bare = await (
    filter.customerId ? bareQ.eq("customer_id", filter.customerId)
    : filter.nurseId  ? bareQ.eq("nurse_id", filter.nurseId)
    : bareQ
  ).order("created_at", { ascending: false });
  if (bare.error || !bare.data) {
    console.error(`[supabase] ${scope} bare list also failed`, {
      code: bare.error?.code, message: bare.error?.message, details: bare.error?.details,
    });
    return null;
  }
  const enriched = await Promise.all(
    (bare.data as unknown as { id: string }[]).map((row) => fetchOrderById(sb, row.id)),
  );
  return enriched.filter((o): o is Order => o != null);
}

export async function fetchOrdersForCustomer(
  sb: SupabaseClient,
  customerId: string
): Promise<Order[] | null> {
  if (!isUuid(customerId)) {
    console.warn("[supabase] fetchOrdersForCustomer skipped: invalid uuid", customerId);
    return null;
  }
  return listOrdersHydrated(sb, { customerId }, `fetchOrdersForCustomer customer=${customerId}`);
}

// Admin variant — no customer filter. Caller is responsible for authorization.
export async function fetchOrdersForAdmin(sb: SupabaseClient): Promise<Order[] | null> {
  return listOrdersHydrated(sb, {}, "fetchOrdersForAdmin");
}

// Nurse variant — only orders assigned to the given nurse_id.
export async function fetchOrdersForNurse(
  sb: SupabaseClient,
  nurseId: string,
): Promise<Order[] | null> {
  if (!isUuid(nurseId)) {
    console.warn("[supabase] fetchOrdersForNurse skipped: invalid uuid", nurseId);
    return null;
  }
  return listOrdersHydrated(sb, { nurseId }, `fetchOrdersForNurse nurse=${nurseId}`);
}

// Mints a 1-hour signed URL for every active OrderResultFile whose fileUrl
// is a Storage path (i.e. not a legacy mock data: URL or /results/* path).
// Service-role client recommended so the signing isn't gated by RLS, but
// any client with read on the bucket works. Failures fall back to leaving
// the original storage path in place so the caller can still detect / log.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function looksLikeStoragePath(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("data:")) return false;
  if (url.startsWith("http://") || url.startsWith("https://")) return false;
  if (url.startsWith("/results/")) return false;
  return true;
}

export async function enrichOrdersWithSignedUrls(
  sb: SupabaseClient,
  orders: Order[],
): Promise<Order[]> {
  // Collect storage paths for active files only — archived files don't need
  // a customer-visible URL and the bucket's customer RLS only permits
  // active rows anyway.
  const paths = new Set<string>();
  for (const o of orders) {
    for (const f of o.resultFiles ?? []) {
      if (f.isActive && looksLikeStoragePath(f.fileUrl)) paths.add(f.fileUrl);
    }
  }
  if (paths.size === 0) return orders;

  const pathList = Array.from(paths);
  const { data, error } = await sb.storage
    .from("lab-results")
    .createSignedUrls(pathList, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.warn("[supabase] createSignedUrls failed", error);
    return orders;
  }
  const signed = new Map<string, string>();
  for (const row of data) {
    if (row.path && row.signedUrl) signed.set(row.path, row.signedUrl);
  }
  return orders.map((o) => {
    if (!o.resultFiles?.length) return o;
    return {
      ...o,
      resultFiles: o.resultFiles.map((f) =>
        f.isActive && signed.has(f.fileUrl)
          ? { ...f, fileUrl: signed.get(f.fileUrl)! }
          : f,
      ),
    };
  });
}

export async function fetchOrderById(sb: SupabaseClient, id: string): Promise<Order | null> {
  if (!isUuid(id)) {
    console.warn("[supabase] fetchOrderById skipped: invalid uuid", id);
    return null;
  }
  const { data, error } = await sb
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[supabase] fetchOrderById embed failed; falling back to bare fetch", {
      id,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return fetchOrderByIdBare(sb, id);
  }
  if (!data) {
    console.warn("[supabase] fetchOrderById: no row for id", id);
    return null;
  }
  return mapRowToOrder(data as unknown as RawOrderRow);
}

// Last-resort hydration when the embedded select fails (missing optional
// table, schema drift, RLS surprise). Pulls the order row and its
// dependencies one query at a time so we never return null on a row that
// definitely exists.
async function fetchOrderByIdBare(sb: SupabaseClient, id: string): Promise<Order | null> {
  const { data: row, error } = await sb
    .from("orders")
    .select(ORDER_SELECT_BARE)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[supabase] fetchOrderByIdBare also failed", {
      id, code: error.code, message: error.message, details: error.details,
    });
    return null;
  }
  if (!row) {
    console.warn("[supabase] fetchOrderByIdBare: no row for id", id);
    return null;
  }
  type Bare = {
    id: string; public_number: string; customer_id: string; kind: string; status: string;
    visit_date: string; shift: string;
    shift_start_time: string | null; shift_end_time: string | null;
    subtotal: number | string; coupon_code: string | null;
    coupon_discount: number | string; total: number | string;
    payment_method: string; payment_status: string;
    nurse_id: string | null; lab_id: string | null;
    internal_notes: string | null; failed_reason: string | null;
    patient_official_name: string | null; patient_national_id: string | null;
    package_snapshot: unknown;
    created_at: string; updated_at: string;
    patient_id: string; address_id: string;
  };
  const r = row as unknown as Bare;
  const [{ data: patient }, { data: address }, { data: items }] = await Promise.all([
    sb.from("patients").select("id, customer_id, name, national_id, note, is_default").eq("id", r.patient_id).maybeSingle(),
    sb.from("addresses").select("id, customer_id, label, description, city, lat, lng, is_default").eq("id", r.address_id).maybeSingle(),
    sb.from("order_items").select("id, lab_test_id, name_ar_snapshot, name_en_snapshot, price_snapshot, display_order").eq("order_id", id),
  ]);
  const composed: RawOrderRow = {
    id: r.id, public_number: r.public_number, customer_id: r.customer_id,
    kind: r.kind, status: r.status,
    visit_date: r.visit_date, shift: r.shift,
    shift_start_time: r.shift_start_time, shift_end_time: r.shift_end_time,
    subtotal: r.subtotal, coupon_code: r.coupon_code,
    coupon_discount: r.coupon_discount, total: r.total,
    payment_method: r.payment_method, payment_status: r.payment_status,
    nurse_id: r.nurse_id, lab_id: r.lab_id,
    internal_notes: r.internal_notes, failed_reason: r.failed_reason,
    patient_official_name: r.patient_official_name,
    patient_national_id: r.patient_national_id,
    package_snapshot: r.package_snapshot,
    created_at: r.created_at, updated_at: r.updated_at,
    address: (address ?? null) as RawAddress | null,
    patient: (patient ?? null) as RawPatient | null,
    items: (items ?? null) as RawItem[] | null,
    events: null,
    result_files: null,
    issues: null,
  };
  return mapRowToOrder(composed);
}

function mapRowToOrder(r: RawOrderRow): Order {
    const address = r.address as unknown as RawAddress;
    const patient = r.patient as unknown as RawPatient;
    return {
      id: r.id,
      publicNumber: r.public_number,
      userId: r.customer_id,
      status: sqlStatusToTs(r.status),
      type: mapKindToType(r.kind),
      packageSnapshot: (r.package_snapshot ?? undefined) as Order["packageSnapshot"],
      items: ((r.items ?? []) as RawItem[])
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        .map<OrderItem>((i) => ({
          id: i.id,
          testId: i.lab_test_id,
          nameAr: i.name_ar_snapshot,
          nameEn: i.name_en_snapshot ?? "",
          priceSnapshot: Number(i.price_snapshot),
        })),
      subtotal: Number(r.subtotal),
      couponCode: r.coupon_code ?? undefined,
      couponDiscount: Number(r.coupon_discount),
      total: Number(r.total),
      shift: r.shift as Shift,
      visitDate: r.visit_date,
      shiftStartTime: r.shift_start_time ?? undefined,
      shiftEndTime: r.shift_end_time ?? undefined,
      address: address ? mapAddress(address) : ({} as Address),
      patient: patient ? mapPatient(patient) : ({} as Patient),
      paymentMethod: r.payment_method as PaymentMethod,
      paymentStatus: r.payment_status as Order["paymentStatus"],
      instructions: [],
      resultFiles: ((r.result_files ?? []) as RawResultFile[]).map<OrderResultFile>((f) => ({
        id: f.id,
        orderId: r.id,
        labId: r.lab_id ?? "",
        fileUrl: f.storage_path,
        fileName: f.file_name,
        uploadedAt: f.uploaded_at,
        uploadedBy: "lab",
        isActive: f.status === "active",
        archivedAt: f.archived_at ?? undefined,
      })),
      nurseId: r.nurse_id ?? undefined,
      labId: r.lab_id ?? undefined,
      internalNotes: r.internal_notes ?? undefined,
      failedReason: r.failed_reason ?? undefined,
      patientVerification: (r.patient_official_name || r.patient_national_id)
        ? {
            orderId: r.id,
            officialName: r.patient_official_name ?? "",
            nationalId: r.patient_national_id ?? "",
          }
        : undefined,
      events: ((r.events ?? []) as RawEvent[]).map<OrderEvent>((e) => ({
        id: e.id,
        orderId: r.id,
        type: (sqlStatusToTs(e.status) as unknown) as OrderEventType,
        actor: mapActor(e.actor_role),
        actorName: e.actor_name ?? undefined,
        note: e.note ?? undefined,
        createdAt: e.created_at,
      })),
      issues: ((r.issues ?? []) as RawLabIssue[]).map((i) => ({
        id: i.id,
        orderId: r.id,
        labId: i.lab_id,
        type: i.type as import("@/lib/types").LabIssueType,
        description: i.description,
        customerMessageAr: i.customer_message_ar ?? undefined,
        status: i.status as import("@/lib/types").LabIssue["status"],
        createdBy: "—",
        createdByRole: (i.created_by_role === "admin" ? "admin" : "lab"),
        createdAt: i.created_at,
        resolvedAt: i.resolved_at ?? undefined,
        resolutionNote: i.resolution_note ?? undefined,
      })),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
}

function mapKindToType(kind: string): Order["type"] {
  if (kind === "package") return "package";
  if (kind === "prescription") return "prescription";
  return "custom";
}

function mapActor(role: string | null): OrderEvent["actor"] {
  if (role === "admin" || role === "operations_admin" || role === "super_admin") return "admin";
  if (role === "nurse") return "nurse";
  if (role === "lab_admin" || role === "lab_uploader" || role === "lab_accounting") return "lab";
  if (role === "customer") return "customer";
  return "system";
}

interface RawAddress {
  id: string; customer_id: string; label: string; description: string;
  city: string; lat: number | null; lng: number | null; is_default: boolean;
}
interface RawPatient {
  id: string; customer_id: string; name: string; national_id: string | null;
  note: string | null; is_default: boolean;
}
interface RawItem {
  id: string; lab_test_id: string; name_ar_snapshot: string;
  name_en_snapshot: string | null; price_snapshot: number; display_order: number | null;
}
interface RawEvent {
  id: string; status: string; actor_role: string | null; actor_name: string | null;
  note: string | null; created_at: string;
}
interface RawResultFile {
  id: string; storage_path: string; file_name: string;
  mime_type: string | null; size_bytes: number | null; status: string;
  uploaded_at: string; archived_at: string | null;
}
interface RawLabIssue {
  id: string; lab_id: string; type: string; description: string;
  customer_message_ar: string | null; status: string;
  created_by_role: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
}
interface RawOrderRow {
  id: string;
  public_number: string;
  customer_id: string;
  kind: string;
  status: string;
  visit_date: string;
  shift: string;
  shift_start_time: string | null;
  shift_end_time: string | null;
  subtotal: number | string;
  coupon_code: string | null;
  coupon_discount: number | string;
  total: number | string;
  payment_method: string;
  payment_status: string;
  nurse_id: string | null;
  lab_id: string | null;
  internal_notes: string | null;
  failed_reason: string | null;
  patient_official_name: string | null;
  patient_national_id: string | null;
  package_snapshot: unknown;
  created_at: string;
  updated_at: string;
  address: RawAddress | null;
  patient: RawPatient | null;
  items: RawItem[] | null;
  events: RawEvent[] | null;
  result_files: RawResultFile[] | null;
  issues: RawLabIssue[] | null;
}

function mapAddress(r: RawAddress): Address {
  return {
    id: r.id,
    userId: r.customer_id,
    label: r.label,
    description: r.description,
    city: r.city,
    lat: r.lat == null ? 0 : Number(r.lat),
    lng: r.lng == null ? 0 : Number(r.lng),
    isDefault: r.is_default,
  };
}

function mapPatient(r: RawPatient): Patient {
  return {
    id: r.id,
    userId: r.customer_id,
    name: r.name,
    nationalId: r.national_id ?? undefined,
    note: r.note ?? undefined,
    isDefault: r.is_default,
  };
}
