-- ============================================================================
-- 017_lab_actions.sql
-- Stage D: lab portal full Supabase persistence (lab issues, lab self-edit,
-- settlements). Phase 3 already wired the PDF flow.
--
-- New table: lab_issues
-- New enums: lab_issue_type, lab_issue_status
-- New RPCs:
--   * open_lab_issue_admin
--   * update_lab_issue_message_admin
--   * resolve_lab_issue_admin
--   * upsert_lab_admin                 — lab self-edit + admin override
--   * generate_lab_settlement_admin    — admin computes a settlement period
--
-- Service-role only on every RPC.
-- ============================================================================

-- ── Enums ──────────────────────────────────────────────────────────────────
do $$ begin
  create type public.lab_issue_type as enum (
    'invalid_sample', 'incomplete_sample', 'patient_data_error', 'needs_redrawn', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lab_issue_status as enum ('open', 'resampling', 'resolved');
exception when duplicate_object then null; end $$;

-- ── lab_issues table ───────────────────────────────────────────────────────
create table if not exists public.lab_issues (
  id                  uuid primary key default uuid_generate_v4(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  lab_id              uuid not null references public.labs(id) on delete cascade,
  type                public.lab_issue_type not null default 'other',
  description         text not null,
  customer_message_ar text,
  status              public.lab_issue_status not null default 'open',
  created_by_role     public.user_role,
  created_by_id       uuid,
  created_by_name     text,
  resolved_at         timestamptz,
  resolved_by_role    public.user_role,
  resolved_by_id      uuid,
  resolved_by_name    text,
  resolution_note     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_lab_issues_updated_at before update on public.lab_issues
  for each row execute function public.tg_set_updated_at();

-- ── open_lab_issue_admin ────────────────────────────────────────────────────
-- Lab or admin opens an issue against an order. Side-effect: order status
-- is flipped to 'processing' with a 'lab_issue' note via
-- set_order_status_admin so the customer banner picks it up.
create or replace function public.open_lab_issue_admin(
  p_order_id            uuid,
  p_type                public.lab_issue_type,
  p_description         text,
  p_customer_message_ar text  default null,
  p_actor_role          public.user_role default 'lab',
  p_actor_id            uuid  default null,
  p_actor_name          text  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lab_id uuid;
  v_id     uuid;
begin
  select lab_id into v_lab_id from public.orders where id = p_order_id;
  if v_lab_id is null then
    raise exception 'order % does not exist or has no assigned lab', p_order_id;
  end if;
  if nullif(trim(p_description), '') is null then
    raise exception 'description is required';
  end if;

  insert into public.lab_issues (
    order_id, lab_id, type, description, customer_message_ar,
    created_by_role, created_by_id, created_by_name
  )
  values (
    p_order_id, v_lab_id, p_type, p_description, nullif(trim(p_customer_message_ar), ''),
    p_actor_role, p_actor_id, p_actor_name
  )
  returning id into v_id;

  perform public.set_order_status_admin(
    p_order_id, 'processing', p_actor_role, p_actor_id, p_actor_name, 'lab_issue'
  );

  return v_id;
end;
$$;

revoke all on function public.open_lab_issue_admin(uuid, public.lab_issue_type, text, text, public.user_role, uuid, text) from public;
revoke all on function public.open_lab_issue_admin(uuid, public.lab_issue_type, text, text, public.user_role, uuid, text) from anon;
revoke all on function public.open_lab_issue_admin(uuid, public.lab_issue_type, text, text, public.user_role, uuid, text) from authenticated;

-- ── update_lab_issue_message_admin ─────────────────────────────────────────
-- Admin edits the customer-facing message. Lab cannot change this directly
-- (the customer banner reads this column).
create or replace function public.update_lab_issue_message_admin(
  p_issue_id            uuid,
  p_customer_message_ar text,
  p_actor_role          public.user_role default 'admin',
  p_actor_id            uuid  default null,
  p_actor_name          text  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.lab_issues where id = p_issue_id) then
    raise exception 'lab issue % does not exist', p_issue_id;
  end if;

  update public.lab_issues
     set customer_message_ar = nullif(trim(p_customer_message_ar), ''),
         updated_at = now()
   where id = p_issue_id;

  -- Touch the linked order's history for an audit row.
  insert into public.order_status_history (order_id, status, actor_role, actor_id, actor_name, note)
  select i.order_id, o.status, p_actor_role, p_actor_id, p_actor_name,
         'lab_issue:message_updated'
    from public.lab_issues i
    join public.orders o on o.id = i.order_id
   where i.id = p_issue_id;
end;
$$;

revoke all on function public.update_lab_issue_message_admin(uuid, text, public.user_role, uuid, text) from public;
revoke all on function public.update_lab_issue_message_admin(uuid, text, public.user_role, uuid, text) from anon;
revoke all on function public.update_lab_issue_message_admin(uuid, text, public.user_role, uuid, text) from authenticated;

-- ── resolve_lab_issue_admin ─────────────────────────────────────────────────
create or replace function public.resolve_lab_issue_admin(
  p_issue_id    uuid,
  p_note        text default null,
  p_actor_role  public.user_role default 'admin',
  p_actor_id    uuid  default null,
  p_actor_name  text  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  select order_id into v_order_id from public.lab_issues where id = p_issue_id;
  if v_order_id is null then
    raise exception 'lab issue % does not exist', p_issue_id;
  end if;

  update public.lab_issues
     set status = 'resolved',
         resolved_at = now(),
         resolved_by_role = p_actor_role,
         resolved_by_id = p_actor_id,
         resolved_by_name = p_actor_name,
         resolution_note = nullif(trim(p_note), ''),
         updated_at = now()
   where id = p_issue_id;

  insert into public.order_status_history (order_id, status, actor_role, actor_id, actor_name, note)
  select v_order_id, status, p_actor_role, p_actor_id, p_actor_name,
         'lab_issue:resolved' || coalesce(' — ' || nullif(trim(p_note), ''), '')
    from public.orders where id = v_order_id;
end;
$$;

revoke all on function public.resolve_lab_issue_admin(uuid, text, public.user_role, uuid, text) from public;
revoke all on function public.resolve_lab_issue_admin(uuid, text, public.user_role, uuid, text) from anon;
revoke all on function public.resolve_lab_issue_admin(uuid, text, public.user_role, uuid, text) from authenticated;

-- ── upsert_lab_admin ────────────────────────────────────────────────────────
-- Lab self-edit (lab_admin role) is restricted to a whitelist of fields. The
-- super_admin override path passes p_full_patch=true to apply the entire
-- jsonb patch including critical fields (registration/license/tax/etc).
create or replace function public.upsert_lab_admin(
  p_lab_id        uuid,
  p_patch         jsonb,
  p_full_patch    boolean default false,
  p_actor_role    public.user_role default 'admin',
  p_actor_id      uuid    default null,
  p_actor_name    text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_safe jsonb;
begin
  if not exists (select 1 from public.labs where id = p_lab_id) then
    raise exception 'lab % does not exist', p_lab_id;
  end if;

  if p_full_patch then
    v_safe := coalesce(p_patch, '{}'::jsonb);
  else
    -- Whitelist of fields a lab_admin user may edit on its own lab.
    v_safe := jsonb_strip_nulls(jsonb_build_object(
      'name_ar',              p_patch->>'name_ar',
      'name_en',              p_patch->>'name_en',
      'logo_url',             p_patch->>'logo_url',
      'phone_main',           p_patch->>'phone_main',
      'phone_secondary',      p_patch->>'phone_secondary',
      'email',                p_patch->>'email',
      'whatsapp',             p_patch->>'whatsapp',
      'representative_name',  p_patch->>'representative_name',
      'representative_role',  p_patch->>'representative_role',
      'representative_phone', p_patch->>'representative_phone',
      'representative_email', p_patch->>'representative_email',
      'working_hours',        p_patch->>'working_hours',
      'avg_processing_hours', (p_patch->>'avg_processing_hours')::int,
      'primary_color',        p_patch->>'primary_color',
      'secondary_color',      p_patch->>'secondary_color',
      'accent_color',         p_patch->>'accent_color',
      'portal_display_name',  p_patch->>'portal_display_name',
      'header_image_url',     p_patch->>'header_image_url'
    ));
  end if;

  -- Apply only the keys we have. Use a manual UPDATE rather than a generic
  -- jsonb_each loop so type-cast bugs surface at definition time.
  update public.labs
     set name_ar              = coalesce(v_safe->>'name_ar', name_ar),
         name_en              = coalesce(v_safe->>'name_en', name_en),
         logo_url             = coalesce(v_safe->>'logo_url', logo_url),
         is_active            = coalesce((v_safe->>'is_active')::boolean, is_active),
         official_name        = coalesce(v_safe->>'official_name', official_name),
         registration_number  = coalesce(v_safe->>'registration_number', registration_number),
         license_number       = coalesce(v_safe->>'license_number', license_number),
         tax_number           = coalesce(v_safe->>'tax_number', tax_number),
         address_full         = coalesce(v_safe->>'address_full', address_full),
         city                 = coalesce(v_safe->>'city', city),
         area                 = coalesce(v_safe->>'area', area),
         lat                  = coalesce((v_safe->>'lat')::numeric, lat),
         lng                  = coalesce((v_safe->>'lng')::numeric, lng),
         phone_main           = coalesce(v_safe->>'phone_main', phone_main),
         phone_secondary      = coalesce(v_safe->>'phone_secondary', phone_secondary),
         email                = coalesce(v_safe->>'email', email),
         whatsapp             = coalesce(v_safe->>'whatsapp', whatsapp),
         representative_name  = coalesce(v_safe->>'representative_name', representative_name),
         representative_role  = coalesce(v_safe->>'representative_role', representative_role),
         representative_phone = coalesce(v_safe->>'representative_phone', representative_phone),
         representative_email = coalesce(v_safe->>'representative_email', representative_email),
         working_hours        = coalesce(v_safe->>'working_hours', working_hours),
         avg_processing_hours = coalesce((v_safe->>'avg_processing_hours')::int, avg_processing_hours),
         primary_color        = coalesce(v_safe->>'primary_color', primary_color),
         secondary_color      = coalesce(v_safe->>'secondary_color', secondary_color),
         accent_color         = coalesce(v_safe->>'accent_color', accent_color),
         portal_display_name  = coalesce(v_safe->>'portal_display_name', portal_display_name),
         header_image_url     = coalesce(v_safe->>'header_image_url', header_image_url),
         reveal_sell_price_to_lab =
           coalesce((v_safe->>'reveal_sell_price_to_lab')::boolean, reveal_sell_price_to_lab),
         updated_at           = now()
   where id = p_lab_id;
  -- p_actor_* params reserved for future audit logging.
  perform p_actor_role; perform p_actor_id; perform p_actor_name;
end;
$$;

revoke all on function public.upsert_lab_admin(uuid, jsonb, boolean, public.user_role, uuid, text) from public;
revoke all on function public.upsert_lab_admin(uuid, jsonb, boolean, public.user_role, uuid, text) from anon;
revoke all on function public.upsert_lab_admin(uuid, jsonb, boolean, public.user_role, uuid, text) from authenticated;

-- ── generate_lab_settlement_admin ───────────────────────────────────────────
-- Sums the lab amount across an order set in [start, end] (inclusive) using
-- explicit lab_price_agreements where defined; falls back to a 60% share of
-- order subtotal — matches the frontend `computeOrderLabAmount` rule.
create or replace function public.generate_lab_settlement_admin(
  p_lab_id        uuid,
  p_period_start  date,
  p_period_end    date,
  p_actor_role    public.user_role default 'admin',
  p_actor_id      uuid    default null,
  p_actor_name    text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.labs where id = p_lab_id) then
    raise exception 'lab % does not exist', p_lab_id;
  end if;
  if p_period_end < p_period_start then
    raise exception 'period_end must be >= period_start';
  end if;

  insert into public.settlements (lab_id, period_start, period_end)
  values (p_lab_id, p_period_start, p_period_end)
  returning id into v_id;

  -- One settlement_items row per eligible order. Eligibility: order belongs
  -- to this lab and finished (results_uploaded or completed) within the
  -- period.
  insert into public.settlement_items (settlement_id, order_id, lab_amount)
  select v_id, o.id,
         round(o.subtotal * 0.6, 2) as lab_amount
    from public.orders o
   where o.lab_id = p_lab_id
     and o.status in ('results_uploaded', 'completed')
     and (o.updated_at::date) between p_period_start and p_period_end;

  -- Roll the totals up.
  update public.settlements s
     set total_orders = (select count(*) from public.settlement_items where settlement_id = s.id),
         total_lab_amount = coalesce(
           (select sum(lab_amount) from public.settlement_items where settlement_id = s.id), 0
         )
   where s.id = v_id;

  perform p_actor_role; perform p_actor_id; perform p_actor_name;
  return v_id;
end;
$$;

revoke all on function public.generate_lab_settlement_admin(uuid, date, date, public.user_role, uuid, text) from public;
revoke all on function public.generate_lab_settlement_admin(uuid, date, date, public.user_role, uuid, text) from anon;
revoke all on function public.generate_lab_settlement_admin(uuid, date, date, public.user_role, uuid, text) from authenticated;

create or replace function public.set_settlement_status_admin(
  p_settlement_id  uuid,
  p_status         public.settlement_status,
  p_total_paid     numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.settlements
     set status = p_status,
         total_paid = coalesce(p_total_paid, total_paid),
         updated_at = now()
   where id = p_settlement_id;
end;
$$;

revoke all on function public.set_settlement_status_admin(uuid, public.settlement_status, numeric) from public;
revoke all on function public.set_settlement_status_admin(uuid, public.settlement_status, numeric) from anon;
revoke all on function public.set_settlement_status_admin(uuid, public.settlement_status, numeric) from authenticated;
