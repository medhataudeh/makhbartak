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
  package_snapshot, created_at, updated_at,
  address:addresses ( id, customer_id, label, description, city, lat, lng, is_default ),
  patient:patients ( id, customer_id, name, national_id, note, is_default ),
  items:order_items ( id, lab_test_id, name_ar_snapshot, name_en_snapshot, price_snapshot, display_order ),
  events:order_status_history ( id, status, actor_role, actor_name, note, created_at ),
  result_files:lab_result_files ( id, storage_path, file_name, mime_type, size_bytes, status, uploaded_at, archived_at )
`;

export async function fetchOrdersForCustomer(
  sb: SupabaseClient,
  customerId: string
): Promise<Order[] | null> {
  if (!isUuid(customerId)) {
    console.warn("[supabase] fetchOrdersForCustomer skipped: invalid uuid", customerId);
    return null;
  }
  const { data, error } = await sb
    .from("orders")
    .select(ORDER_SELECT)
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error || !data) return null;
  return (data as unknown as RawOrderRow[]).map(mapRowToOrder);
}

// Admin variant — no customer filter. Caller is responsible for authorization.
export async function fetchOrdersForAdmin(sb: SupabaseClient): Promise<Order[] | null> {
  const { data, error } = await sb
    .from("orders")
    .select(ORDER_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error || !data) return null;
  return (data as unknown as RawOrderRow[]).map(mapRowToOrder);
}

export async function fetchOrderById(sb: SupabaseClient, id: string): Promise<Order | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await sb
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return mapRowToOrder(data as unknown as RawOrderRow);
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
      events: ((r.events ?? []) as RawEvent[]).map<OrderEvent>((e) => ({
        id: e.id,
        orderId: r.id,
        type: (sqlStatusToTs(e.status) as unknown) as OrderEventType,
        actor: mapActor(e.actor_role),
        actorName: e.actor_name ?? undefined,
        note: e.note ?? undefined,
        createdAt: e.created_at,
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
  package_snapshot: unknown;
  created_at: string;
  updated_at: string;
  address: RawAddress | null;
  patient: RawPatient | null;
  items: RawItem[] | null;
  events: RawEvent[] | null;
  result_files: RawResultFile[] | null;
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
