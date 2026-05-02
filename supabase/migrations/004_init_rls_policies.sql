-- ============================================================================
-- 004_init_rls_policies.sql
-- Row Level Security. Run after 002_init_tables.sql + 003_init_indexes.sql.
--
-- Rules of thumb:
--   - admin can do everything via the helper public.is_admin().
--   - customers see ONLY rows tied to their own customers.id.
--   - nurses see ONLY rows tied to their own nurses.id (and orders assigned
--     to them).
--   - lab users see ONLY rows tied to their own lab_id (via lab_users).
--   - service_role bypasses RLS by definition (use it for backend tasks).
-- ============================================================================

-- ── Enable RLS on every domain table ---------------------------------------
alter table public.profiles                 enable row level security;
alter table public.customers                enable row level security;
alter table public.patients                 enable row level security;
alter table public.addresses                enable row level security;
alter table public.labs                     enable row level security;
alter table public.lab_users                enable row level security;
alter table public.nurses                   enable row level security;
alter table public.test_categories          enable row level security;
alter table public.lab_tests                enable row level security;
alter table public.instruction_library      enable row level security;
alter table public.lab_test_instructions    enable row level security;
alter table public.nurse_tools              enable row level security;
alter table public.lab_test_required_tools  enable row level security;
alter table public.packages                 enable row level security;
alter table public.package_items            enable row level security;
alter table public.lab_price_agreements     enable row level security;
alter table public.orders                   enable row level security;
alter table public.order_items              enable row level security;
alter table public.order_status_history     enable row level security;
alter table public.order_notes              enable row level security;
alter table public.prescriptions            enable row level security;
alter table public.prescription_matches     enable row level security;
alter table public.lab_result_files         enable row level security;
alter table public.lab_result_file_events   enable row level security;
alter table public.lab_issues               enable row level security;
alter table public.ratings                  enable row level security;
alter table public.notifications            enable row level security;
alter table public.coupons                  enable row level security;
alter table public.payments                 enable row level security;
alter table public.settlements              enable row level security;
alter table public.settlement_items         enable row level security;
alter table public.shortage_requests        enable row level security;
alter table public.shortage_request_items   enable row level security;
alter table public.admin_activity_logs      enable row level security;
alter table public.content_pages            enable row level security;
alter table public.app_settings             enable row level security;

-- ============================================================================
-- profiles
-- ============================================================================
create policy "profiles_self_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "profiles_self_update" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

create policy "profiles_admin_all" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- customers
-- ============================================================================
create policy "customers_self_select" on public.customers
  for select using (profile_id = auth.uid() or public.is_admin());

create policy "customers_self_update" on public.customers
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "customers_admin_all" on public.customers
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- patients
-- ============================================================================
create policy "patients_owner_all" on public.patients
  for all using (customer_id = public.current_customer_id())
  with check (customer_id = public.current_customer_id());

create policy "patients_admin_all" on public.patients
  for all using (public.is_admin()) with check (public.is_admin());

-- Nurses must read patients of orders assigned to them.
create policy "patients_nurse_read_assigned" on public.patients
  for select using (
    public.is_nurse() and exists (
      select 1 from public.orders o
       where o.patient_id = patients.id
         and o.nurse_id   = public.current_nurse_id()
    )
  );

-- ============================================================================
-- addresses (same shape as patients)
-- ============================================================================
create policy "addresses_owner_all" on public.addresses
  for all using (customer_id = public.current_customer_id())
  with check (customer_id = public.current_customer_id());

create policy "addresses_admin_all" on public.addresses
  for all using (public.is_admin()) with check (public.is_admin());

create policy "addresses_nurse_read_assigned" on public.addresses
  for select using (
    public.is_nurse() and exists (
      select 1 from public.orders o
       where o.address_id = addresses.id
         and o.nurse_id   = public.current_nurse_id()
    )
  );

-- ============================================================================
-- labs (public read-only catalog; admin can write)
-- ============================================================================
create policy "labs_public_read_active" on public.labs
  for select using (is_active or public.is_admin() or public.current_lab_id() = labs.id);

create policy "labs_admin_all" on public.labs
  for all using (public.is_admin()) with check (public.is_admin());

create policy "labs_self_update_noncritical" on public.labs
  for update using (public.is_lab_user() and public.current_lab_id() = labs.id);
-- NOTE: column-level guard on the "critical" fields (official_name, license_number,
-- registration_number, tax_number, address_full, lat, lng, reveal_sell_price_to_lab)
-- is enforced at the API layer or via a BEFORE UPDATE trigger if you want a
-- belt-and-suspenders rule in the database.

-- ============================================================================
-- lab_users (admin manages; lab user reads own row)
-- ============================================================================
create policy "lab_users_self_read" on public.lab_users
  for select using (profile_id = auth.uid() or public.is_admin() or lab_id = public.current_lab_id());

create policy "lab_users_admin_all" on public.lab_users
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- nurses
-- ============================================================================
create policy "nurses_admin_all" on public.nurses
  for all using (public.is_admin()) with check (public.is_admin());

create policy "nurses_self_read" on public.nurses
  for select using (profile_id = auth.uid());

create policy "nurses_self_update_noncritical" on public.nurses
  for update using (profile_id = auth.uid());

-- ============================================================================
-- catalog (test_categories, lab_tests, instruction_library,
-- lab_test_instructions, nurse_tools, lab_test_required_tools, packages,
-- package_items, lab_price_agreements)
-- ============================================================================
-- Public catalog: any signed-in user reads active rows; admin writes.
-- Lab/nurse read everything (they need it operationally).

create policy "catalog_public_read" on public.test_categories
  for select using (is_active or public.is_admin());
create policy "catalog_admin_all" on public.test_categories
  for all using (public.is_admin()) with check (public.is_admin());

create policy "tests_public_read" on public.lab_tests
  for select using (is_active or public.is_admin() or public.is_lab_user() or public.is_nurse());
create policy "tests_admin_all" on public.lab_tests
  for all using (public.is_admin()) with check (public.is_admin());

create policy "instruction_library_read" on public.instruction_library
  for select using (is_active or public.is_admin());
create policy "instruction_library_admin_all" on public.instruction_library
  for all using (public.is_admin()) with check (public.is_admin());

create policy "lab_test_instructions_read" on public.lab_test_instructions
  for select using (true);
create policy "lab_test_instructions_admin_all" on public.lab_test_instructions
  for all using (public.is_admin()) with check (public.is_admin());

create policy "nurse_tools_read" on public.nurse_tools
  for select using (is_active or public.is_admin() or public.is_nurse());
create policy "nurse_tools_admin_all" on public.nurse_tools
  for all using (public.is_admin()) with check (public.is_admin());

create policy "lab_test_required_tools_read" on public.lab_test_required_tools
  for select using (true);
create policy "lab_test_required_tools_admin_all" on public.lab_test_required_tools
  for all using (public.is_admin()) with check (public.is_admin());

create policy "packages_public_read" on public.packages
  for select using (is_active or public.is_admin());
create policy "packages_admin_all" on public.packages
  for all using (public.is_admin()) with check (public.is_admin());

create policy "package_items_read" on public.package_items for select using (true);
create policy "package_items_admin_all" on public.package_items
  for all using (public.is_admin()) with check (public.is_admin());

-- Price agreements: lab can see its own; admin sees all.
create policy "price_agreements_admin_all" on public.lab_price_agreements
  for all using (public.is_admin()) with check (public.is_admin());
create policy "price_agreements_lab_self_read" on public.lab_price_agreements
  for select using (public.is_lab_user() and lab_id = public.current_lab_id());

-- ============================================================================
-- orders
-- ============================================================================
-- Customer: only their own orders. Nurse: only assigned orders. Lab: only
-- assigned-to-this-lab orders. Admin: all.
create policy "orders_customer_self" on public.orders
  for select using (customer_id = public.current_customer_id() or public.is_admin());

create policy "orders_customer_insert" on public.orders
  for insert with check (customer_id = public.current_customer_id());

create policy "orders_customer_update_self" on public.orders
  for update using (customer_id = public.current_customer_id())
  with check (customer_id = public.current_customer_id());

create policy "orders_admin_all" on public.orders
  for all using (public.is_admin()) with check (public.is_admin());

create policy "orders_nurse_assigned_select" on public.orders
  for select using (public.is_nurse() and nurse_id = public.current_nurse_id());

create policy "orders_nurse_assigned_update" on public.orders
  for update using (public.is_nurse() and nurse_id = public.current_nurse_id());

create policy "orders_lab_assigned_select" on public.orders
  for select using (public.is_lab_user() and lab_id = public.current_lab_id());

create policy "orders_lab_assigned_update" on public.orders
  for update using (public.is_lab_user() and lab_id = public.current_lab_id());

-- ============================================================================
-- order_items
-- ============================================================================
create policy "order_items_visible_with_order" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
       where o.id = order_items.order_id
         and (
           o.customer_id = public.current_customer_id()
           or (public.is_nurse() and o.nurse_id = public.current_nurse_id())
           or (public.is_lab_user() and o.lab_id = public.current_lab_id())
           or public.is_admin()
         )
    )
  );

create policy "order_items_admin_all" on public.order_items
  for all using (public.is_admin()) with check (public.is_admin());

create policy "order_items_customer_insert" on public.order_items
  for insert with check (
    exists (select 1 from public.orders o
             where o.id = order_items.order_id
               and o.customer_id = public.current_customer_id())
  );

-- ============================================================================
-- order_status_history + order_notes
-- ============================================================================
create policy "order_status_history_visible_with_order" on public.order_status_history
  for select using (
    exists (
      select 1 from public.orders o
       where o.id = order_status_history.order_id
         and (
           o.customer_id = public.current_customer_id()
           or (public.is_nurse() and o.nurse_id = public.current_nurse_id())
           or (public.is_lab_user() and o.lab_id = public.current_lab_id())
           or public.is_admin()
         )
    )
  );

create policy "order_status_history_actor_insert" on public.order_status_history
  for insert with check (
    public.is_admin() or public.is_nurse() or public.is_lab_user()
  );

create policy "order_notes_admin_all" on public.order_notes
  for all using (public.is_admin()) with check (public.is_admin());

create policy "order_notes_lab_or_nurse_for_assigned" on public.order_notes
  for select using (
    public.is_admin() or exists (
      select 1 from public.orders o
       where o.id = order_notes.order_id
         and (
           (public.is_nurse() and o.nurse_id = public.current_nurse_id())
           or (public.is_lab_user() and o.lab_id = public.current_lab_id())
         )
    )
  );

-- ============================================================================
-- prescriptions + matches
-- ============================================================================
create policy "prescriptions_owner" on public.prescriptions
  for all using (customer_id = public.current_customer_id())
  with check (customer_id = public.current_customer_id());

create policy "prescriptions_admin_all" on public.prescriptions
  for all using (public.is_admin()) with check (public.is_admin());

create policy "prescription_matches_visible_with_pres" on public.prescription_matches
  for select using (
    exists (
      select 1 from public.prescriptions p
       where p.id = prescription_matches.prescription_id
         and (p.customer_id = public.current_customer_id() or public.is_admin())
    )
  );

create policy "prescription_matches_admin_all" on public.prescription_matches
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- lab_result_files + events
-- ============================================================================
-- Customer: only ACTIVE files for their own orders.
create policy "lab_result_files_customer_active" on public.lab_result_files
  for select using (
    status = 'active' and exists (
      select 1 from public.orders o
       where o.id = lab_result_files.order_id
         and o.customer_id = public.current_customer_id()
    )
  );

create policy "lab_result_files_admin_all" on public.lab_result_files
  for all using (public.is_admin()) with check (public.is_admin());

create policy "lab_result_files_lab_assigned" on public.lab_result_files
  for all using (
    public.is_lab_user() and lab_id = public.current_lab_id()
  ) with check (
    public.is_lab_user() and lab_id = public.current_lab_id()
  );

-- File event log mirrors the file's visibility.
create policy "lab_result_file_events_admin_all" on public.lab_result_file_events
  for all using (public.is_admin()) with check (public.is_admin());

create policy "lab_result_file_events_lab_self" on public.lab_result_file_events
  for select using (
    public.is_lab_user() and exists (
      select 1 from public.orders o
       where o.id = lab_result_file_events.order_id
         and o.lab_id = public.current_lab_id()
    )
  );

-- ============================================================================
-- lab_issues
-- ============================================================================
create policy "lab_issues_admin_all" on public.lab_issues
  for all using (public.is_admin()) with check (public.is_admin());

create policy "lab_issues_lab_self" on public.lab_issues
  for all using (public.is_lab_user() and lab_id = public.current_lab_id())
  with check (public.is_lab_user() and lab_id = public.current_lab_id());

-- Customer can read only the public-safe fields of issues on their own orders.
-- (Postgres doesn't do column-level RLS without views — read your client-side
-- query carefully; never SELECT internal `description` for customers.)
create policy "lab_issues_customer_self_read" on public.lab_issues
  for select using (
    exists (
      select 1 from public.orders o
       where o.id = lab_issues.order_id
         and o.customer_id = public.current_customer_id()
    )
  );

-- ============================================================================
-- ratings
-- ============================================================================
create policy "ratings_owner_rw" on public.ratings
  for all using (customer_id = public.current_customer_id())
  with check (customer_id = public.current_customer_id());

create policy "ratings_admin_all" on public.ratings
  for all using (public.is_admin()) with check (public.is_admin());

-- Nurse / lab can read their own scores.
create policy "ratings_nurse_self_read" on public.ratings
  for select using (public.is_nurse() and nurse_id = public.current_nurse_id());

create policy "ratings_lab_self_read" on public.ratings
  for select using (public.is_lab_user() and lab_id = public.current_lab_id());

-- ============================================================================
-- notifications
-- ============================================================================
create policy "notifications_recipient_rw" on public.notifications
  for all using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create policy "notifications_admin_all" on public.notifications
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- coupons
-- ============================================================================
create policy "coupons_public_read_active" on public.coupons
  for select using (is_active or public.is_admin());

create policy "coupons_admin_all" on public.coupons
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- payments
-- ============================================================================
create policy "payments_owner_read" on public.payments
  for select using (
    exists (select 1 from public.orders o
             where o.id = payments.order_id
               and o.customer_id = public.current_customer_id())
    or public.is_admin()
  );

create policy "payments_admin_all" on public.payments
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- settlements
-- ============================================================================
create policy "settlements_admin_all" on public.settlements
  for all using (public.is_admin()) with check (public.is_admin());

create policy "settlements_lab_self_read" on public.settlements
  for select using (public.is_lab_user() and lab_id = public.current_lab_id());

create policy "settlement_items_admin_all" on public.settlement_items
  for all using (public.is_admin()) with check (public.is_admin());

create policy "settlement_items_lab_self_read" on public.settlement_items
  for select using (
    public.is_lab_user() and exists (
      select 1 from public.settlements s
       where s.id = settlement_items.settlement_id
         and s.lab_id = public.current_lab_id()
    )
  );

-- ============================================================================
-- shortage_requests + items
-- ============================================================================
create policy "shortage_requests_nurse_self" on public.shortage_requests
  for all using (public.is_nurse() and nurse_id = public.current_nurse_id())
  with check (public.is_nurse() and nurse_id = public.current_nurse_id());

create policy "shortage_requests_admin_all" on public.shortage_requests
  for all using (public.is_admin()) with check (public.is_admin());

create policy "shortage_request_items_visible_with_request" on public.shortage_request_items
  for select using (
    exists (
      select 1 from public.shortage_requests r
       where r.id = shortage_request_items.request_id
         and (r.nurse_id = public.current_nurse_id() or public.is_admin())
    )
  );

create policy "shortage_request_items_nurse_insert" on public.shortage_request_items
  for insert with check (
    exists (
      select 1 from public.shortage_requests r
       where r.id = shortage_request_items.request_id
         and r.nurse_id = public.current_nurse_id()
    )
  );

create policy "shortage_request_items_admin_all" on public.shortage_request_items
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- admin_activity_logs (admin only)
-- ============================================================================
create policy "admin_activity_logs_admin_all" on public.admin_activity_logs
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- content_pages (anyone authenticated reads active; admin writes)
-- ============================================================================
create policy "content_pages_read_active" on public.content_pages
  for select using (is_active or public.is_admin());

create policy "content_pages_admin_all" on public.content_pages
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- app_settings (anyone reads; admin writes)
-- ============================================================================
create policy "app_settings_read_all" on public.app_settings
  for select using (true);

create policy "app_settings_admin_write" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());
