// ─── Core Entity Types ─────────────────────────────────────────────────────

export interface User {
  id: string;
  phone: string;
  name?: string;
  createdAt: string;
}

export interface Patient {
  id: string;
  userId: string;
  name: string;
  nationalId?: string;
  note?: string;
  isDefault: boolean;
}

export interface Address {
  id: string;
  userId: string;
  label: string;
  description: string;
  lat: number;
  lng: number;
  city: string;
  isDefault: boolean;
}

export interface TestCategory {
  id: string;
  nameAr: string;
  nameEn: string;
}

export interface Test {
  id: string;
  nameAr: string;
  nameEn: string;
  shortName: string;
  aliasesAr: string[];
  aliasesEn: string[];
  categoryId: string;
  category?: TestCategory;
  sampleType: string;
  costPrice: number;
  sellPrice: number;
  /** Legacy plain-text instructions — kept for backwards compat. New work
   *  should prefer `customerInstructions` (structured + key-deduplicated). */
  instructionsAr: string[];
  /** Legacy plain-text tool labels — kept for backwards compat. New work
   *  should prefer `nurseTools` (structured with quantity/required). */
  tools: string[];
  /** Structured customer-facing instructions (admin-curated). */
  customerInstructions?: TestInstruction[];
  /** Structured nurse tools requirement (admin-curated). */
  nurseTools?: TestToolReq[];
  isActive: boolean;
}

// ─── Test instructions (structured, customer-facing) ───────────────────────
// Why structured: multiple tests in the same order may share instructions
// (e.g. fasting). The dedup pipeline groups by `key` and renders once.
export interface TestInstruction {
  id: string;
  /** Stable dedupe key, e.g. "fasting_8h", "drink_water_only", "id_ready". */
  key: string;
  titleAr: string;
  bodyAr: string;
  /** Lucide icon token, e.g. "clock", "droplets", "id-card". */
  icon: string;
  /** Lower numbers render first. */
  priority: number;
  isActive: boolean;
}

// ─── Test tool requirements (nurse checklist) ──────────────────────────────
export interface TestToolReq {
  /** References LibraryTool.id. */
  toolId: string;
  /** Units needed per single instance of this test. */
  quantityPerTest: number;
  /** required = appears in checklist by default; optional = collapsed. */
  required: boolean;
  /** Optional admin note shown below the checklist line. */
  note?: string;
}

// ─── Library catalogs (admin-curated) ──────────────────────────────────────
// The library is the source of truth for known instructions/tools. Tests
// reference library entries; ad-hoc rows on a test are also allowed.
export interface LibraryInstruction {
  id: string;
  key: string;
  titleAr: string;
  bodyAr: string;
  icon: string;
  priority: number;
  isActive: boolean;
}

export interface LibraryTool {
  id: string;
  nameAr: string;
  /** Display unit, e.g. "حبة", "أنبوب", "عبوة", "زوج". Free text. */
  unit: string;
  isActive: boolean;
}

/** Admin-tunable defaults for the morning prep checklist. */
export interface NurseChecklistDefaults {
  /** Tools always added regardless of orders (e.g. labels, gloves base set). */
  defaultToolIds: string[];
  /** Buffer percentage applied on aggregated quantities (0..100). */
  bufferPct: number;
}

export interface Package {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  fullDescriptionAr: string;
  category: PackageCategory;
  tests: Test[];
  price: number;
  originalPrice: number;
  mainImage: string;
  mobileImage: string;
  desktopImage: string;
  badgeAr?: string;
  displayOrder: number;
  showInSlider: boolean;
  isActive: boolean;
}

export type PackageCategory = "all" | "athletes" | "slimming" | "vitamins" | "checkup";

export interface CartItem {
  test: Test;
  quantity: number;
}

export interface Cart {
  id: string;
  userId: string;
  type: "package" | "prescription" | "custom";
  packageId?: string;
  package?: Package;
  items: CartItem[];
  couponCode?: string;
  couponDiscount?: number;
  shift?: Shift;
  addressId?: string;
  address?: Address;
  patientId?: string;
  patient?: Patient;
  paymentMethod?: PaymentMethod;
}

export type Shift = "morning" | "evening";

export interface ShiftConfig {
  shift: Shift;
  labelAr: string;
  startHour: number;
  endHour: number;
  available: boolean;
  unavailableReason?: string;
}

export type PaymentMethod = "online" | "cash";

export interface Coupon {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minOrderAmount: number;
  maxDiscount: number;
  usageLimit: number;
  usedCount: number;
  startDate: string;
  expiryDate: string;
  isActive: boolean;
}

export type OrderStatus =
  | "created"
  | "priced"
  | "scheduled"
  | "confirmed"
  | "nurse_assigned"
  | "on_the_way"
  | "arrived"
  | "sample_collected"
  | "sent_to_lab"
  | "lab_processing"
  | "result_ready"
  | "completed"
  | "failed_to_collect"
  | "lab_issue"
  | "cancelled";

export interface OrderItem {
  id: string;
  testId: string;
  nameAr: string;
  nameEn: string;
  priceSnapshot: number;
}

export interface Order {
  id: string;
  /** Public-facing order number shown to customers (e.g. HL-2026-000123). */
  publicNumber?: string;
  userId: string;
  status: OrderStatus;
  type: "package" | "prescription" | "custom";
  /** Snapshot of the package at order time when type === "package". */
  packageSnapshot?: OrderPackageSnapshot;
  items: OrderItem[];
  packageNameAr?: string;
  subtotal: number;
  couponCode?: string;
  couponDiscount: number;
  total: number;
  shift: Shift;
  visitDate: string;
  /** Snapshot of the shift window at booking time — useful when admin later
   *  edits SystemSettings and you still want to display the original times. */
  shiftStartTime?: string;
  shiftEndTime?: string;
  address: Address;
  patient: Patient;
  /** Filled by the nurse during patient verification. */
  patientVerification?: PatientVerification;
  paymentMethod: PaymentMethod;
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  instructions: Instruction[];
  /** @deprecated kept for old screens — prefer resultFiles. */
  resultPdfUrl?: string;
  resultFiles?: OrderResultFile[];
  /** Customer-uploaded prescription image. Storage path on create; signed
   *  URL after enrichOrdersWithSignedUrls. NULL for non-prescription orders. */
  prescriptionUrl?: string;
  nurseId?: string;
  labId?: string;
  internalNotes?: string;
  /** Structured admin/lab notes — preferred over `internalNotes`. */
  notes?: OrderNote[];
  failedReason?: string;
  /** @deprecated single string — prefer `issues`. */
  labIssue?: string;
  /** All lab issues raised against this order. */
  issues?: LabIssue[];
  /** Chronological event log for the timeline tab. */
  events?: OrderEvent[];
  /** Per-file lifecycle log (uploaded / replaced / archived / restored). */
  fileEvents?: OrderFileEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderPackageSnapshot {
  packageId: string;
  nameAr: string;
  nameEn: string;
  image: string;
  testsCount: number;
  price: number;
}

export interface OrderNote {
  id: string;
  orderId: string;
  authorId: string;
  authorName: string;
  authorRole: "admin" | "lab" | "nurse";
  text: string;
  createdAt: string;
}

export type LabIssueType =
  | "invalid_sample"
  | "incomplete_sample"
  | "patient_data_error"
  | "needs_redrawn"
  | "other";

export interface LabIssue {
  id: string;
  orderId: string;
  labId: string;
  type: LabIssueType;
  /** Internal description visible to admin + lab. */
  description: string;
  /** Customer-facing message (admin-editable). Defaults to a safe generic. */
  customerMessageAr?: string;
  status: "open" | "resampling" | "resolved";
  createdBy: string;
  createdByRole: "lab" | "admin";
  createdAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

export type OrderEventType =
  | "created"
  | "scheduled"
  | "confirmed"
  | "nurse_assigned"
  | "on_the_way"
  | "arrived"
  | "sample_collected"
  | "sent_to_lab"
  | "lab_processing"
  | "result_uploaded"
  | "result_ready"
  | "result_sent"
  | "completed"
  | "failed_collection"
  | "lab_issue_opened"
  | "lab_issue_resolved"
  | "rescheduled"
  | "cancelled"
  | "payment_status_changed"
  | "coupon_applied"
  | "note_added";

export interface OrderEvent {
  id: string;
  orderId: string;
  type: OrderEventType;
  /** Who triggered the event. `system` for automated transitions. */
  actor: "admin" | "nurse" | "lab" | "customer" | "system";
  actorName?: string;
  note?: string;
  createdAt: string;
}

// ─── Customer-facing status mapping ────────────────────────────────────────
// Internal statuses collapse into 7 buckets the customer sees, plus a
// distinct "needs follow-up" state for failures so they aren't silently buried.
// Six customer-facing buckets. There is NO separate "result_ready" bucket on
// the customer side: when the lab confirms result delivery, the order moves
// directly to `completed` and the result PDFs become the dominant element.
export type CustomerOrderStatus =
  | "received"
  | "confirmed"
  | "on_the_way"
  | "sample_collected"
  | "in_lab"
  | "completed"
  | "needs_attention";

export const CUSTOMER_STATUS_LABELS: Record<CustomerOrderStatus, string> = {
  received: "تم استلام الطلب",
  confirmed: "تم تأكيد الموعد",
  on_the_way: "الممرض في الطريق",
  sample_collected: "تم أخذ العينة",
  in_lab: "العينة في المختبر",
  completed: "مكتمل",
  needs_attention: "يحتاج متابعة",
};

/** Order in which customer-facing steps appear in the progress UI. */
export const CUSTOMER_STATUS_STEPS: CustomerOrderStatus[] = [
  "received",
  "confirmed",
  "on_the_way",
  "sample_collected",
  "in_lab",
  "completed",
];

export interface OrderResultFile {
  id: string;
  orderId: string;
  labId: string;
  fileUrl: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  note?: string;
  /** When this file replaced an older one, the older file's id. */
  replacedById?: string;
  /** When this file was archived (replaced or hidden). */
  archivedAt?: string;
  archivedBy?: string;
  isActive: boolean;
}

/** Per-file lifecycle event recorded inside the order. */
export type OrderFileEventType =
  | "uploaded"
  | "replaced"
  | "archived"
  | "restored";

export interface OrderFileEvent {
  id: string;
  orderId: string;
  fileId: string;
  fileName: string;
  type: OrderFileEventType;
  actor: "lab" | "admin";
  actorName: string;
  note?: string;
  createdAt: string;
}

export interface Instruction {
  id: string;
  icon: string;
  textAr: string;
  textEn: string;
}

export interface Notification {
  id: string;
  userId: string;
  titleAr: string;
  bodyAr: string;
  type: NotificationType;
  orderId?: string;
  isRead: boolean;
  createdAt: string;
}

export type NotificationType =
  | "order_confirmed"
  | "nurse_assigned"
  | "nurse_on_way"
  | "sample_collected"
  | "result_ready"
  | "payment_issue"
  | "route_changed"
  | "appointment_cancelled"
  | "lab_issue"
  | "admin_note";

export interface Prescription {
  id: string;
  imageUrl: string;
  matches: PrescriptionMatch[];
  hasUnclearItem: boolean;
}

export interface PrescriptionMatch {
  id: string;
  rawText: string;
  matchedTest?: Test;
  confidence: number;
  isUnclear: boolean;
}

// Nurse types
export interface Nurse {
  id: string;
  name: string;
  phone: string;
  city: string;
  photoUrl?: string;
  isActive: boolean;
}

export interface NurseLevel {
  id: string;
  name: string;
  minPoints: number;
  color: string;
}

export interface NurseBadge {
  id: string;
  name: string;
  /** lucide:icon-name token */
  icon: string;
  description: string;
  awardedAt?: string;
}

export interface NurseGamification {
  nurseId: string;
  totalCompleted: number;
  totalPoints: number;
  pointsToday: number;
  level: NurseLevel;
  badges: NurseBadge[];
  monthlyCompleted: number;
  monthlyPoints: number;
  successRate: number;     // 0..100
  failedCount: number;
  streak: number;          // consecutive days with at least one completed visit
}

export interface NurseRouteStop {
  orderId: string;
  order: Order;
  /** Admin-controlled position in today's route. 1-based. */
  sequence: number;
  status: "pending" | "completed" | "failed" | "skipped";
}

export interface NurseRoute {
  nurseId: string;
  date: string;            // YYYY-MM-DD
  stops: NurseRouteStop[];
}

export interface GamificationConfig {
  pointPerCompletion: number;
  pointPerLabDelivery: number;
  pointStreakBonus: number;
  levels: NurseLevel[];
  badges: NurseBadge[];
}

export interface NurseAssignment {
  orderId: string;
  order: Order;
  nurseId: string;
}

export interface FailedCollectionReason {
  value: string;
  labelAr: string;
}

export interface PatientVerification {
  orderId: string;
  officialName: string;
  nationalId: string;
  note?: string;
}

// Lab types
// Stage 1 keeps the legacy `name`/`phone` fields callable so existing screens
// don't break; richer fields are optional and filled in seed data.
export interface Lab {
  id: string;
  /** Legacy display name — alias for `nameAr` for older screens. */
  name: string;
  /** Legacy main phone — alias for `phoneMain` for older screens. */
  phone: string;

  // Basic info
  nameAr: string;
  nameEn: string;
  logo?: string;
  isActive: boolean;

  // Official information
  officialName?: string;
  registrationNumber?: string;
  licenseNumber?: string;
  taxNumber?: string;
  addressFull?: string;
  city?: string;
  area?: string;
  lat?: number;
  lng?: number;

  // Contact information
  phoneMain: string;
  phoneSecondary?: string;
  email?: string;
  whatsapp?: string;

  // Representative
  representative?: LabRepresentative;

  // Operational settings
  supportedCities?: string[];
  workingHours?: string;
  acceptedSampleTypes?: string[];
  avgProcessingHours?: number;

  // Branding (lab portal customization)
  branding?: LabBranding;

  /** When true, the lab portal shows the customer sell price. Default false. */
  revealSellPriceToLab?: boolean;
}

export interface LabRepresentative {
  fullName: string;
  role: string;
  phone: string;
  email?: string;
}

export interface LabBranding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  portalDisplayName?: string;
  logo?: string;
  headerImage?: string;
}

export interface LabResult {
  orderId: string;
  pdfUrl: string;
  uploadedAt: string;
}

// ─── App-wide branding (admin-editable, persisted in localStorage) ─────────
export interface BrandingConfig {
  /** Logos by surface — admin-managed URLs in this prototype. */
  logos: {
    main: string;
    header: string;
    mobile: string;
    desktop: string;
    light: string;
    dark?: string;
    favicon: string;
    pwaIcon: string;
    adminDashboard: string;
    nurseInterface?: string;
    labPortal?: string;
  };
  theme: {
    primary: string;     // cyan-600 by default
    cta: string;         // emerald-600 by default
    accent: string;      // surface tint
  };
  /** Background style for the customer app shell. */
  background: "soft-mesh" | "subtle-shapes" | "plain";
}

// Admin types

/**
 * Public system settings — exposed by /api/system/settings to ALL clients
 * (customer, nurse, lab, admin, unauthenticated guests). Anything finance-
 * sensitive, internal, or operational-intelligence-only must NOT live here.
 *
 * Splitting this from {@link AdminSystemSettings} is the type-side of the
 * public/private settings split. The runtime narrowing happens at the API
 * boundary (/api/system/settings drops admin-only keys); this type makes
 * the contract explicit so future additions are forced to choose a side.
 */
export interface PublicSystemSettings {
  minBookingNoticeMinutes: number;
  morningShiftStart: string;
  morningShiftEnd: string;
  eveningShiftStart: string;
  eveningShiftEnd: string;
  supportedCities: string[];
  whatsappNumber: string;
  /** When true, cash orders enter the operational workflow without paying first. */
  allowCashOrders: boolean;
  /**
   * Days a customer may book *in addition to* today. Default 2 → today,
   * tomorrow, and the day after. The date picker renders bookingWindowDays + 1
   * cells; getShiftConfigs() rejects dates outside that range.
   */
  bookingWindowDays: number;
  /**
   * Hard cap on confirmed orders per shift per date. 0 = unlimited.
   * Kept public deliberately: backend enforces the cap at order creation; the
   * client value drives the date-picker grey-out as a UX courtesy. Disclosure
   * risk is negligible.
   */
  maxOrdersPerShift: number;
  // ─── Phase 3.5 finance preparation (Stripe) ─────────────────────────────
  /** When true, the customer cart will route online payments through Stripe. */
  enableStripe?: boolean;
  /** Publishable key — safe to ship to the browser by Stripe's design. */
  stripePublicKey?: string;
  /** "test" or "live" — guards the cart from using a test key in production. */
  stripeMode?: "test" | "live";
}

/**
 * Admin system settings — superset of {@link PublicSystemSettings}, served
 * only by /api/admin/system/settings GET behind requireAdminCap. Carries
 * fields that operational/finance staff need but customers must never see.
 */
export interface AdminSystemSettings extends PublicSystemSettings {
  // ─── Phase 4.1 commission ───────────────────────────────────────────────
  /** Percentage (0–100) of order.total accrued as platform commission when an
   *  order completes. 0 disables the accrual. Persisted as
   *  app_settings.nurse_commission_percentage. Finance-sensitive — admin only. */
  nurseCommissionPercentage?: number;
}

/**
 * Backward-compat alias. Existing imports of `SystemSettings` resolve to the
 * admin (full) shape. Public consumers should narrow to
 * {@link PublicSystemSettings} as a follow-up cleanup; the API boundary is
 * the load-bearing strictness, not the type alias.
 */
export type SystemSettings = AdminSystemSettings;

export interface AdminStats {
  todayOrders: number;
  pendingOrders: number;
  completedToday: number;
  revenue: number;
}

// ─── Slider, Admin, Invoices, Activity, Icons ──────────────────────────────

export type SliderCtaTarget =
  | "package"
  | "custom-builder"
  | "prescription"
  | "external";

export interface SliderItem {
  id: string;
  titleAr: string;
  subtitleAr: string;
  mobileImage: string;
  desktopImage: string;
  priceLabel: string;
  ctaLabel: string;
  ctaTarget: SliderCtaTarget;
  ctaTargetId?: string;
  testsCount?: number;
  badgeAr?: string;
  displayOrder: number;
  isActive: boolean;
}

// Customer-home action cards ("أو ابدأ بطريقتك"). DB-driven content managed
// from the admin dashboard; see migration 047 + src/lib/home-actions.ts.
export type HomeActionType = "prescription" | "custom-builder" | "package" | "external";

export interface HomeActionSection {
  id: string;
  titleAr: string;
  descriptionAr: string;
  ctaLabelAr: string;
  actionType: HomeActionType;
  actionValue?: string;     // package uuid or external url, by actionType
  icon: string;             // lucide icon name
  imageUrl: string;
  accent: string;           // visual style key: purple|emerald|cyan|amber
  displayOrder: number;
  isActive: boolean;
}

// ─── Unified mock auth ──────────────────────────────────────────────────────
// One row per login account across the four portals. AdminUser, LabUser, etc.
// are projected into this shape by lib/auth.ts so the four sign-in screens
// share a single store. linkedEntityId points at the role-specific record:
//   role "customer" → customers.id (UUID — see SEED_CUSTOMER_*_ID in mock-data)
//   role "nurse"    → Nurse.id (e.g. "nur-1")
//   role "lab"      → LabUser.id (lab portal also reads labId via LabUser)
//   role "admin"    → AdminUser.id (e.g. "ad-1")
export type Role = "customer" | "nurse" | "lab" | "admin";

export const ROLE_HOME_PATH: Record<Role, string> = {
  customer: "/",
  nurse: "/nurse",
  lab: "/lab",
  admin: "/admin",
};

export interface AuthUser {
  id: string;
  username: string;
  password: string; // mock-only; production stores a server-side hash
  name: string;
  role: Role;
  linkedEntityId: string;
  isActive: boolean;
  lastLoginAt?: string;
}

// Phase 8: AuthSession is now derived from Supabase Auth + /api/me (which
// joins profiles + the role-specific extension table). The shape preserves
// every field legacy callers read (`linkedEntityId`) plus role-specific
// fields populated by the server.
export interface AuthSession {
  userId: string;          // auth.users.id == profiles.id
  username: string;        // email (kept under the legacy field name)
  name: string;            // profiles.full_name
  phone?: string;          // profiles.phone (set during signup; editable via admin)
  role: Role;
  linkedEntityId: string;  // role-specific id: customers.id / nurses.id /
                           // lab_users.id / profiles.id (admin)
  customerId?: string;
  nurseId?: string;
  nurseCity?: string;
  nursePhotoUrl?: string;
  labUserId?: string;
  labId?: string;
  labRole?: "lab_admin" | "lab_accounting" | "lab_uploader";
  adminRole?:
    | "super_admin" | "operations_admin" | "lab_admin"
    | "customer_support" | "finance_admin" | "content_admin";
}

export type AdminRole =
  | "super_admin"
  | "operations_admin"
  | "lab_admin"
  | "customer_support"
  | "finance_admin"
  | "content_admin";

export interface AdminUser {
  id: string;
  username: string;
  password: string; // mock-only; in production this is a hash on the server
  name: string;
  role: AdminRole;
  isActive: boolean;
  lastLogin?: string;
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "مدير عام",
  operations_admin: "مدير العمليات",
  lab_admin: "مدير المخبر",
  customer_support: "دعم العملاء",
  finance_admin: "مدير المالية",
  content_admin: "مدير المحتوى",
};

// Permission matrix — what each role can manage in the admin dashboard.
//
// NOTE: this matrix gates UI section *visibility* in the admin nav. The
// authoritative API capability matrix is `ADMIN_CAPS` in
// `lib/admin-permissions.ts`; per CLAUDE.md the two are intentionally
// kept separate today. Any role listed here as having "settings" must
// also hold `system.app_settings.read` in `ADMIN_CAPS` (otherwise their
// SettingsAdmin GET would 403 and fall through to the explicit
// forbidden state, surfacing as a confused-looking screen).
export const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  super_admin: ["*"],
  // operations_admin holds `system.app_settings.read` and benefits from a
  // read-only view of system settings during operational triage. They do
  // NOT hold `system.app_settings.write` — SettingsAdmin's existing
  // <fieldset disabled={!canWrite}> path renders the form read-only.
  operations_admin: ["overview", "orders", "users", "nurses", "scheduling", "gamification", "shortages", "notifications", "settings"],
  // Test catalog editing is admin-only (super_admin / content_admin). The
  // admin sub-role "lab_admin" oversees lab partnerships and operations but
  // must not touch the tests catalog.
  lab_admin: ["overview", "orders", "labs"],
  customer_support: ["overview", "orders", "users", "notifications"],
  // finance_admin holds `system.app_settings.read` (commission rate is
  // finance-sensitive operational config). Same read-only fieldset
  // behaviour applies as for operations_admin.
  finance_admin: ["overview", "finance", "invoices", "payments", "coupons", "settings"],
  content_admin: ["overview", "tests", "packages", "sliders", "home_actions", "icons", "branding", "content", "libraries", "media", "settings"],
};

// Phase 5.1 — full payment lifecycle on the payments table. Order-level
// `Order.paymentStatus` stays narrow (pending | paid | failed | refunded)
// because the orders.payment_status column itself is collapsed: any
// successful collection (nurse OR admin OR webhook) flips it to 'paid'.
// The granular view lives on the payments row and is exposed here for
// admin/finance UI components.
export type PaymentRowStatus =
  | "pending"
  | "paid"                 // legacy + admin-confirmed shorthand
  | "paid_by_nurse"        // mig 033: nurse collected, awaiting admin verify
  | "verified_by_admin"    // mig 033: admin (or webhook) verified
  | "partially_refunded"   // mig 033: at least one refund txn, balance > 0
  | "refunded"             // fully refunded
  | "failed"
  | "cancelled";

// Customer-side / invoice-side narrow union (legacy callers).
export type PaymentStatus = "pending" | "paid" | "refunded" | "cancelled";

// Wallet ledger types — must match the SQL enum public.nurse_wallet_txn_type.
// Migrations 031 → 033 added cash_refund and refund.
export type NurseWalletTxnType =
  | "cash_collected"
  | "commission_earned"
  | "settlement_paid"
  | "adjustment"
  | "cash_refund"
  | "refund";

export type NurseWalletTxnDirection = "credit" | "debit";

// Convenience: which payment-row statuses count as "the order received money".
export const PAID_PAYMENT_ROW_STATUSES: ReadonlySet<PaymentRowStatus> = new Set([
  "paid", "paid_by_nurse", "verified_by_admin", "partially_refunded",
]);

export function isPaymentRowPaid(status: string | null | undefined): boolean {
  return !!status && (PAID_PAYMENT_ROW_STATUSES as ReadonlySet<string>).has(status);
}

export interface InvoiceItem {
  id: string;
  nameAr: string;
  nameEn: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  orderId: string;
  customerPhone: string;
  patientName: string;
  items: InvoiceItem[];
  subtotal: number;
  packageDiscount: number;
  couponCode?: string;
  couponDiscount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  issuedAt: string;
}

export type ActivityAction =
  | "login"
  | "logout"
  | "order_update"
  | "price_change"
  | "coupon_change"
  | "invoice_status"
  | "user_edit"
  | "test_edit"
  | "package_edit"
  | "slider_edit"
  | "icon_edit"
  | "settings_change";

export interface ActivityLog {
  id: string;
  adminId: string;
  adminName: string;
  role: AdminRole;
  action: ActivityAction;
  entity: string;
  entityId: string;
  details: string;
  createdAt: string;
}

export const ACTIVITY_LABELS: Record<ActivityAction, string> = {
  login: "تسجيل دخول",
  logout: "تسجيل خروج",
  order_update: "تحديث طلب",
  price_change: "تعديل سعر",
  coupon_change: "تعديل كوبون",
  invoice_status: "تحديث فاتورة",
  user_edit: "تعديل مستخدم",
  test_edit: "تعديل تحليل",
  package_edit: "تعديل باقة",
  slider_edit: "تعديل سلايدر",
  icon_edit: "تعديل أيقونة",
  settings_change: "تعديل إعدادات",
};

export type IconCategory = "instruction" | "package" | "slider" | "general";

export interface SvgIcon {
  id: string;
  nameAr: string;
  nameEn: string;
  /** Raw inline SVG markup, or a known lucide token (e.g. "lucide:droplets"). */
  svg: string;
  category: IconCategory;
  isActive: boolean;
}

// ─── Content pages (CMS) ────────────────────────────────────────────────────
export type ContentPageSlug = "terms" | "privacy" | "support" | "faq";

export interface ContentPage {
  id: string;
  slug: ContentPageSlug;
  titleAr: string;
  bodyAr: string;
  /** Optional structured FAQ items rendered when slug === "faq". */
  faqItems?: { q: string; a: string }[];
  /** Optional support contact metadata rendered when slug === "support". */
  supportPhone?: string;
  supportWhatsapp?: string;
  isActive: boolean;
  updatedAt: string;
}

// ─── Order ratings ──────────────────────────────────────────────────────────
export interface OrderRating {
  id: string;
  orderId: string;
  userId: string;
  nurseId?: string;
  labId?: string;
  /** 1..5; undefined when there was no nurse on the order. */
  nurseRating?: number;
  /** 1..5; undefined when there was no lab on the order. */
  labRating?: number;
  /** 1..5 — overall test experience. */
  overallRating: number;
  comment?: string;
  createdAt: string;
}

// ─── Lab users + permissions ────────────────────────────────────────────────
export type LabUserRole = "lab_admin" | "lab_accounting" | "lab_uploader";

export const LAB_USER_ROLE_LABELS: Record<LabUserRole, string> = {
  lab_admin:      "مدير المخبر",
  lab_accounting: "محاسب المخبر",
  lab_uploader:   "موظف رفع نتائج",
};

export interface LabUser {
  id: string;
  labId: string;
  username: string;
  /** Plain-text in this prototype, parallel to MOCK_ADMINS. Server-side hash in production. */
  password: string;
  fullName: string;
  role: LabUserRole;
  isActive: boolean;
  lastLoginAt?: string;
}

// ─── Per-lab pricing agreement (per test) ───────────────────────────────────
export interface LabPriceAgreement {
  id: string;
  labId: string;
  testId: string;
  /** What the platform pays the lab when this test runs. */
  labPrice: number;
  effectiveFrom: string;
  isActive: boolean;
}

// ─── Lab settlements (monthly) ──────────────────────────────────────────────
export type LabSettlementStatus = "pending" | "partially_paid" | "paid";

export interface LabSettlement {
  id: string;
  labId: string;
  /** YYYY-MM-DD inclusive. */
  periodStart: string;
  /** YYYY-MM-DD inclusive. */
  periodEnd: string;
  totalOrders: number;
  totalLabAmount: number;
  totalPaid: number;
  status: LabSettlementStatus;
  notes?: string;
  createdAt: string;
}

export interface LabSettlementItem {
  id: string;
  settlementId: string;
  orderId: string;
  /** Sum of agreed lab prices for the order's items at settlement time. */
  labAmount: number;
  status: LabSettlementStatus;
}

// ─── Customer-facing fallbacks for lab issues ───────────────────────────────
export const DEFAULT_LAB_ISSUE_CUSTOMER_MESSAGE_AR =
  "حدثت مشكلة في العينة، وسيتم التواصل معك من فريق الدعم.";

// ─── Nurse tool shortage requests ───────────────────────────────────────────
// Filed by a nurse during morning prep when she discovers the kit is missing
// items. Admin handles the request through an explicit status pipeline so
// procurement is auditable.
export type NurseToolShortageStatus =
  | "pending"     // just created, admin hasn't looked at it
  | "preparing"   // admin started preparing the items
  | "sent"        // dispatched to the nurse
  | "resolved"    // nurse confirmed receipt / admin closed
  | "cancelled";

export const NURSE_SHORTAGE_STATUS_LABELS: Record<NurseToolShortageStatus, string> = {
  pending:   "بانتظار المراجعة",
  preparing: "قيد التحضير",
  sent:      "تم الإرسال",
  resolved:  "تم الاستلام",
  cancelled: "ملغي",
};

export interface NurseToolShortageItem {
  id: string;
  requestId: string;
  toolId: string;
  /** Library tool name snapshot — convenient when the tool is later renamed. */
  toolNameAr?: string;
  requestedQuantity: number;
}

export interface NurseToolShortageRequest {
  id: string;
  nurseId: string;
  /** Nurse name snapshot at filing time. */
  nurseName?: string;
  /** Day the request applies to (YYYY-MM-DD). */
  date: string;
  status: NurseToolShortageStatus;
  /** Nurse's optional explanation. */
  note?: string;
  /** Internal admin note added when handling the request. */
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}
