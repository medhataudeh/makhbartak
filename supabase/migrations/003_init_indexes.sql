-- ============================================================================
-- 003_init_indexes.sql
-- Hot-path indexes. Run after 002_init_tables.sql.
-- ============================================================================

-- profiles
create index if not exists idx_profiles_role        on public.profiles(role);
create index if not exists idx_profiles_active      on public.profiles(is_active);

-- customers / patients / addresses
create index if not exists idx_patients_customer    on public.patients(customer_id) where deleted_at is null;
create index if not exists idx_addresses_customer   on public.addresses(customer_id) where deleted_at is null;
create unique index if not exists ux_patients_one_default
  on public.patients(customer_id) where is_default and deleted_at is null;
create unique index if not exists ux_addresses_one_default
  on public.addresses(customer_id) where is_default and deleted_at is null;

-- labs / lab users
create index if not exists idx_labs_active          on public.labs(is_active);
create index if not exists idx_lab_users_lab        on public.lab_users(lab_id);

-- nurses
create index if not exists idx_nurses_active_city   on public.nurses(is_active, city);

-- catalog
create index if not exists idx_lab_tests_active     on public.lab_tests(is_active);
create index if not exists idx_lab_tests_category   on public.lab_tests(category_id);
create index if not exists idx_packages_active      on public.packages(is_active);
create index if not exists idx_package_items_pkg    on public.package_items(package_id);
create index if not exists idx_package_items_test   on public.package_items(lab_test_id);
create index if not exists idx_lab_test_instr_test  on public.lab_test_instructions(lab_test_id);
create index if not exists idx_lab_test_tools_test  on public.lab_test_required_tools(lab_test_id);
create index if not exists idx_price_agreements_lab on public.lab_price_agreements(lab_id, lab_test_id) where is_active;

-- orders — the hottest table
create index if not exists idx_orders_status        on public.orders(status);
create index if not exists idx_orders_payment       on public.orders(payment_status);
create index if not exists idx_orders_customer      on public.orders(customer_id);
create index if not exists idx_orders_nurse         on public.orders(nurse_id);
create index if not exists idx_orders_lab           on public.orders(lab_id);
create index if not exists idx_orders_visit_date    on public.orders(visit_date);
-- Common composite for nurse "today's route" + admin scheduling.
create index if not exists idx_orders_nurse_date    on public.orders(nurse_id, visit_date, shift) where status not in ('cancelled','refunded');
-- Common composite for the lab portal.
create index if not exists idx_orders_lab_status    on public.orders(lab_id, status);
-- Customer orders list ordered by create time.
create index if not exists idx_orders_customer_recent on public.orders(customer_id, created_at desc);

create index if not exists idx_order_items_order    on public.order_items(order_id);
create index if not exists idx_order_status_history_order on public.order_status_history(order_id, created_at);
create index if not exists idx_order_notes_order    on public.order_notes(order_id, created_at);

-- prescriptions
create index if not exists idx_prescriptions_customer on public.prescriptions(customer_id, created_at desc);
create index if not exists idx_prescription_matches_pres on public.prescription_matches(prescription_id);

-- result files
create index if not exists idx_lab_result_files_order on public.lab_result_files(order_id);
create index if not exists idx_lab_result_files_active on public.lab_result_files(order_id) where status = 'active';
create index if not exists idx_lab_result_file_events_order on public.lab_result_file_events(order_id, created_at);

-- lab issues
create index if not exists idx_lab_issues_order     on public.lab_issues(order_id);
create index if not exists idx_lab_issues_lab_open  on public.lab_issues(lab_id, status) where status <> 'resolved';

-- ratings
create index if not exists idx_ratings_nurse        on public.ratings(nurse_id);
create index if not exists idx_ratings_lab          on public.ratings(lab_id);

-- notifications
create index if not exists idx_notifications_recipient on public.notifications(recipient_id, is_read, created_at desc);

-- coupons
create index if not exists idx_coupons_active       on public.coupons(is_active);

-- payments
create index if not exists idx_payments_order       on public.payments(order_id, created_at desc);

-- settlements
create index if not exists idx_settlements_lab      on public.settlements(lab_id, period_start desc);
create index if not exists idx_settlement_items_set on public.settlement_items(settlement_id);

-- shortage requests
create index if not exists idx_shortage_nurse       on public.shortage_requests(nurse_id, date desc);
create index if not exists idx_shortage_pending     on public.shortage_requests(status) where status = 'pending';
create index if not exists idx_shortage_items_req   on public.shortage_request_items(request_id);

-- audit + content
create index if not exists idx_admin_activity_created on public.admin_activity_logs(created_at desc);
create index if not exists idx_admin_activity_actor   on public.admin_activity_logs(actor_id, created_at desc);
create index if not exists idx_content_pages_active   on public.content_pages(slug) where is_active;
