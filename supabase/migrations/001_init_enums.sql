-- ============================================================================
-- 001_init_enums.sql
-- Enum types for مختبرك / Makhbartak. Run first.
-- ============================================================================

-- Required extensions ---------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ── Roles -------------------------------------------------------------------
create type public.user_role as enum (
  'customer',
  'admin',
  'lab',
  'nurse'
);

-- ── Order lifecycle (production state machine) ------------------------------
create type public.order_status as enum (
  'pending_payment',   -- created, online payment not confirmed yet
  'paid',              -- online paid OR cash allowed
  'assigned',          -- nurse + lab assigned
  'nurse_on_way',
  'sample_collected',
  'received_by_lab',
  'processing',
  'results_uploaded',  -- internal: lab finished upload
  'completed',         -- customer-facing terminal happy path
  'cancelled',
  'refunded'
);

-- ── Payments ----------------------------------------------------------------
create type public.payment_method as enum ('cash', 'online');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded');

-- ── Booking shift -----------------------------------------------------------
create type public.shift_window as enum ('morning', 'evening');

-- ── Order origin (matches frontend `Order.type`) ----------------------------
create type public.order_kind as enum ('package', 'custom', 'prescription');

-- ── Sample type -------------------------------------------------------------
create type public.sample_type as enum ('blood', 'urine', 'saliva', 'stool', 'other');

-- ── Lab issues --------------------------------------------------------------
create type public.lab_issue_type as enum (
  'invalid_sample',
  'incomplete_sample',
  'patient_data_error',
  'needs_redrawn',
  'other'
);
create type public.lab_issue_status as enum ('open', 'resampling', 'resolved');

-- ── Result file lifecycle (admin sees archived; customer doesn't) -----------
create type public.result_file_status as enum ('active', 'archived', 'replaced');
create type public.result_file_event_type as enum ('uploaded', 'replaced', 'archived', 'restored');

-- ── Notifications -----------------------------------------------------------
create type public.notification_type as enum (
  'order_received',
  'order_confirmed',
  'nurse_assigned',
  'nurse_on_way',
  'sample_collected',
  'results_ready',
  'payment_issue',
  'route_changed',
  'appointment_cancelled',
  'lab_issue',
  'admin_note',
  'shortage_request_update'
);

-- ── Settlements -------------------------------------------------------------
create type public.settlement_status as enum ('pending', 'partially_paid', 'paid');

-- ── Shortage requests -------------------------------------------------------
create type public.shortage_status as enum ('pending', 'preparing', 'sent', 'resolved', 'cancelled');

-- ── Coupons -----------------------------------------------------------------
create type public.coupon_type as enum ('percentage', 'fixed');

-- ── Content pages -----------------------------------------------------------
create type public.content_page_slug as enum ('terms', 'privacy', 'support', 'faq');

-- ── Activity log actions (admin audit) --------------------------------------
create type public.activity_action as enum (
  'login',
  'logout',
  'order_create',
  'order_update',
  'price_change',
  'coupon_change',
  'invoice_status',
  'user_edit',
  'test_edit',
  'package_edit',
  'slider_edit',
  'icon_edit',
  'settings_change',
  'lab_edit',
  'lab_user_edit',
  'lab_issue',
  'lab_settlement',
  'shortage_handled',
  'content_edit',
  'branding_edit',
  'library_edit'
);
