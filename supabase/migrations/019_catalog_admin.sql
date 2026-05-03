-- ============================================================================
-- 019_catalog_admin.sql
-- Stage F: full Supabase persistence for catalog (tests, packages,
-- instructions library, nurse tools), coupons, app settings, content pages,
-- and home sliders. Service-role only on every RPC.
--
-- New table: home_sliders (per D1 in the Stage F plan).
-- ============================================================================

-- ── home_sliders ────────────────────────────────────────────────────────────
do $$ begin
  create type public.slider_cta_target as enum (
    'package', 'custom-builder', 'prescription', 'external'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.home_sliders (
  id              uuid primary key default uuid_generate_v4(),
  title_ar        text not null,
  subtitle_ar     text,
  mobile_image    text,
  desktop_image   text,
  price_label     text,
  cta_label       text,
  cta_target      public.slider_cta_target not null,
  cta_target_id   text,
  tests_count     int,
  badge_ar        text,
  display_order   int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_home_sliders_updated_at before update on public.home_sliders
  for each row execute function public.tg_set_updated_at();

-- ── Generic helper: assert non-blank text ──────────────────────────────────
create or replace function public._require_text(p_val text, p_label text)
returns void language plpgsql immutable as $$
begin
  if p_val is null or length(trim(p_val)) = 0 then
    raise exception '% is required', p_label;
  end if;
end;
$$;

-- ============================================================================
-- TESTS
-- ============================================================================
create or replace function public.upsert_test_admin(
  p_id          uuid    default null,
  p_category_id uuid    default null,
  p_name_ar     text    default null,
  p_name_en     text    default null,
  p_short_name  text    default null,
  p_aliases_ar  text[]  default null,
  p_aliases_en  text[]  default null,
  p_sample_type public.sample_type default 'blood',
  p_cost_price  numeric default 0,
  p_sell_price  numeric default 0,
  p_is_active   boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._require_text(p_name_ar, 'name_ar');

  if p_id is null then
    insert into public.lab_tests (
      category_id, name_ar, name_en, short_name, aliases_ar, aliases_en,
      sample_type, cost_price, sell_price, is_active
    )
    values (
      p_category_id, trim(p_name_ar), nullif(trim(p_name_en), ''), nullif(trim(p_short_name), ''),
      coalesce(p_aliases_ar, '{}'), coalesce(p_aliases_en, '{}'),
      p_sample_type, coalesce(p_cost_price, 0), coalesce(p_sell_price, 0),
      coalesce(p_is_active, true)
    )
    returning id into v_id;
  else
    update public.lab_tests
       set category_id = coalesce(p_category_id, category_id),
           name_ar = trim(p_name_ar),
           name_en = nullif(trim(p_name_en), ''),
           short_name = nullif(trim(p_short_name), ''),
           aliases_ar = coalesce(p_aliases_ar, aliases_ar),
           aliases_en = coalesce(p_aliases_en, aliases_en),
           sample_type = coalesce(p_sample_type, sample_type),
           cost_price = coalesce(p_cost_price, cost_price),
           sell_price = coalesce(p_sell_price, sell_price),
           is_active  = coalesce(p_is_active, is_active),
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.upsert_test_admin(uuid, uuid, text, text, text, text[], text[], public.sample_type, numeric, numeric, boolean) from public, anon, authenticated;

create or replace function public.delete_test_admin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.lab_tests set deleted_at = now(), is_active = false where id = p_id;
end;
$$;
revoke all on function public.delete_test_admin(uuid) from public, anon, authenticated;

-- ============================================================================
-- PACKAGES
-- ============================================================================
create or replace function public.upsert_package_admin(
  p_id              uuid    default null,
  p_name_ar         text    default null,
  p_name_en         text    default null,
  p_description_ar  text    default null,
  p_full_description_ar text default null,
  p_category        text    default null,
  p_price           numeric default 0,
  p_original_price  numeric default 0,
  p_main_image_url  text    default null,
  p_mobile_image_url text   default null,
  p_desktop_image_url text  default null,
  p_badge_ar        text    default null,
  p_display_order   int     default 0,
  p_show_in_slider  boolean default false,
  p_is_active       boolean default true,
  p_test_ids        uuid[]  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_idx int := 0;
  v_test_id uuid;
begin
  perform public._require_text(p_name_ar, 'name_ar');

  if p_id is null then
    insert into public.packages (
      name_ar, name_en, description_ar, full_description_ar, category,
      price, original_price, main_image_url, mobile_image_url, desktop_image_url,
      badge_ar, display_order, show_in_slider, is_active
    )
    values (
      trim(p_name_ar), nullif(trim(p_name_en), ''),
      nullif(trim(p_description_ar), ''), nullif(trim(p_full_description_ar), ''),
      nullif(trim(p_category), ''),
      coalesce(p_price, 0), coalesce(p_original_price, 0),
      nullif(trim(p_main_image_url), ''), nullif(trim(p_mobile_image_url), ''),
      nullif(trim(p_desktop_image_url), ''),
      nullif(trim(p_badge_ar), ''), coalesce(p_display_order, 0),
      coalesce(p_show_in_slider, false), coalesce(p_is_active, true)
    )
    returning id into v_id;
  else
    update public.packages
       set name_ar = trim(p_name_ar),
           name_en = nullif(trim(p_name_en), ''),
           description_ar = nullif(trim(p_description_ar), ''),
           full_description_ar = nullif(trim(p_full_description_ar), ''),
           category = nullif(trim(p_category), ''),
           price = coalesce(p_price, price),
           original_price = coalesce(p_original_price, original_price),
           main_image_url = coalesce(nullif(trim(p_main_image_url), ''), main_image_url),
           mobile_image_url = coalesce(nullif(trim(p_mobile_image_url), ''), mobile_image_url),
           desktop_image_url = coalesce(nullif(trim(p_desktop_image_url), ''), desktop_image_url),
           badge_ar = coalesce(nullif(trim(p_badge_ar), ''), badge_ar),
           display_order = coalesce(p_display_order, display_order),
           show_in_slider = coalesce(p_show_in_slider, show_in_slider),
           is_active = coalesce(p_is_active, is_active),
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;

  -- Atomically rewrite package_items when a list was provided.
  if p_test_ids is not null then
    delete from public.package_items where package_id = v_id;
    foreach v_test_id in array p_test_ids loop
      insert into public.package_items (package_id, lab_test_id, display_order)
      values (v_id, v_test_id, v_idx)
      on conflict (package_id, lab_test_id) do nothing;
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_id;
end;
$$;
revoke all on function public.upsert_package_admin(uuid, text, text, text, text, text, numeric, numeric, text, text, text, text, int, boolean, boolean, uuid[]) from public, anon, authenticated;

create or replace function public.delete_package_admin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.packages set deleted_at = now(), is_active = false where id = p_id;
end;
$$;
revoke all on function public.delete_package_admin(uuid) from public, anon, authenticated;

-- ============================================================================
-- INSTRUCTIONS LIBRARY + per-test links
-- ============================================================================
create or replace function public.upsert_instruction_admin(
  p_id        uuid    default null,
  p_key       text    default null,
  p_title_ar  text    default null,
  p_body_ar   text    default null,
  p_icon      text    default null,
  p_priority  int     default 50,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_text(p_key, 'key');
  perform public._require_text(p_title_ar, 'title_ar');

  if p_id is null then
    insert into public.instruction_library (key, title_ar, body_ar, icon, priority, is_active)
    values (
      trim(p_key), trim(p_title_ar),
      nullif(trim(p_body_ar), ''), nullif(trim(p_icon), ''),
      coalesce(p_priority, 50), coalesce(p_is_active, true)
    )
    returning id into v_id;
  else
    update public.instruction_library
       set key = trim(p_key),
           title_ar = trim(p_title_ar),
           body_ar = nullif(trim(p_body_ar), ''),
           icon = nullif(trim(p_icon), ''),
           priority = coalesce(p_priority, priority),
           is_active = coalesce(p_is_active, is_active),
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.upsert_instruction_admin(uuid, text, text, text, text, int, boolean) from public, anon, authenticated;

create or replace function public.delete_instruction_admin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.instruction_library where id = p_id;
end;
$$;
revoke all on function public.delete_instruction_admin(uuid) from public, anon, authenticated;

create or replace function public.set_test_instructions_admin(
  p_test_id        uuid,
  p_instruction_ids uuid[]
)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  delete from public.lab_test_instructions where lab_test_id = p_test_id;
  if p_instruction_ids is not null then
    foreach v_id in array p_instruction_ids loop
      insert into public.lab_test_instructions (lab_test_id, library_instruction_id)
      values (p_test_id, v_id)
      on conflict (lab_test_id, library_instruction_id) do nothing;
    end loop;
  end if;
end;
$$;
revoke all on function public.set_test_instructions_admin(uuid, uuid[]) from public, anon, authenticated;

-- ============================================================================
-- NURSE TOOLS + per-test links
-- ============================================================================
create or replace function public.upsert_nurse_tool_admin(
  p_id        uuid    default null,
  p_name_ar   text    default null,
  p_unit      text    default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_text(p_name_ar, 'name_ar');
  perform public._require_text(p_unit, 'unit');

  if p_id is null then
    insert into public.nurse_tools (name_ar, unit, is_active)
    values (trim(p_name_ar), trim(p_unit), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.nurse_tools
       set name_ar = trim(p_name_ar),
           unit = trim(p_unit),
           is_active = coalesce(p_is_active, is_active),
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.upsert_nurse_tool_admin(uuid, text, text, boolean) from public, anon, authenticated;

create or replace function public.delete_nurse_tool_admin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.nurse_tools where id = p_id;
end;
$$;
revoke all on function public.delete_nurse_tool_admin(uuid) from public, anon, authenticated;

create or replace function public.set_test_required_tool_admin(
  p_test_id           uuid,
  p_tool_id           uuid,
  p_quantity_per_test int     default 1,
  p_required          boolean default true,
  p_note              text    default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.lab_test_required_tools (
    lab_test_id, nurse_tool_id, quantity_per_test, required, note
  )
  values (
    p_test_id, p_tool_id, coalesce(p_quantity_per_test, 1),
    coalesce(p_required, true), nullif(trim(p_note), '')
  )
  on conflict (lab_test_id, nurse_tool_id) do update
    set quantity_per_test = excluded.quantity_per_test,
        required = excluded.required,
        note = excluded.note;
end;
$$;
revoke all on function public.set_test_required_tool_admin(uuid, uuid, int, boolean, text) from public, anon, authenticated;

create or replace function public.delete_test_required_tool_admin(
  p_test_id uuid, p_tool_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.lab_test_required_tools
   where lab_test_id = p_test_id and nurse_tool_id = p_tool_id;
end;
$$;
revoke all on function public.delete_test_required_tool_admin(uuid, uuid) from public, anon, authenticated;

-- ============================================================================
-- COUPONS
-- ============================================================================
create or replace function public.upsert_coupon_admin(
  p_id              uuid    default null,
  p_code            text    default null,
  p_type            public.coupon_type default 'percentage',
  p_value           numeric default 0,
  p_min_order_amount numeric default 0,
  p_max_discount    numeric default 0,
  p_usage_limit     int     default 0,
  p_start_date      date    default current_date,
  p_expiry_date     date    default current_date,
  p_is_active       boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_text(p_code, 'code');

  if p_id is null then
    insert into public.coupons (
      code, type, value, min_order_amount, max_discount,
      usage_limit, start_date, expiry_date, is_active
    )
    values (
      upper(trim(p_code)), p_type, coalesce(p_value, 0),
      coalesce(p_min_order_amount, 0), coalesce(p_max_discount, 0),
      coalesce(p_usage_limit, 0), p_start_date, p_expiry_date,
      coalesce(p_is_active, true)
    )
    returning id into v_id;
  else
    update public.coupons
       set code = upper(trim(p_code)),
           type = coalesce(p_type, type),
           value = coalesce(p_value, value),
           min_order_amount = coalesce(p_min_order_amount, min_order_amount),
           max_discount = coalesce(p_max_discount, max_discount),
           usage_limit = coalesce(p_usage_limit, usage_limit),
           start_date = coalesce(p_start_date, start_date),
           expiry_date = coalesce(p_expiry_date, expiry_date),
           is_active = coalesce(p_is_active, is_active),
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.upsert_coupon_admin(uuid, text, public.coupon_type, numeric, numeric, numeric, int, date, date, boolean) from public, anon, authenticated;

create or replace function public.delete_coupon_admin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.coupons where id = p_id;
end;
$$;
revoke all on function public.delete_coupon_admin(uuid) from public, anon, authenticated;

-- ============================================================================
-- APP SETTINGS  (single-row table; id=1)
-- ============================================================================
create or replace function public.update_app_settings_admin(
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_safe jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  insert into public.app_settings (id) values (1) on conflict (id) do nothing;
  update public.app_settings
     set min_booking_notice_minutes = coalesce((v_safe->>'min_booking_notice_minutes')::int, min_booking_notice_minutes),
         morning_shift_start = coalesce((v_safe->>'morning_shift_start')::time, morning_shift_start),
         morning_shift_end   = coalesce((v_safe->>'morning_shift_end')::time, morning_shift_end),
         evening_shift_start = coalesce((v_safe->>'evening_shift_start')::time, evening_shift_start),
         evening_shift_end   = coalesce((v_safe->>'evening_shift_end')::time, evening_shift_end),
         supported_cities    = coalesce(
           array(select jsonb_array_elements_text(v_safe->'supported_cities')),
           supported_cities
         ),
         whatsapp_number     = coalesce(v_safe->>'whatsapp_number', whatsapp_number),
         allow_cash_orders   = coalesce((v_safe->>'allow_cash_orders')::boolean, allow_cash_orders),
         booking_horizon_days = coalesce((v_safe->>'booking_horizon_days')::int, booking_horizon_days),
         max_orders_per_shift = coalesce((v_safe->>'max_orders_per_shift')::int, max_orders_per_shift)
   where id = 1;
end;
$$;
revoke all on function public.update_app_settings_admin(jsonb) from public, anon, authenticated;

-- ============================================================================
-- CONTENT PAGES
-- ============================================================================
create or replace function public.upsert_content_page_admin(
  p_id          uuid    default null,
  p_slug        public.content_page_slug default null,
  p_title_ar    text    default null,
  p_body_ar     text    default null,
  p_faq_items   jsonb   default null,
  p_support_phone text  default null,
  p_support_whatsapp text default null,
  p_is_active   boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_text(p_title_ar, 'title_ar');

  if p_id is null then
    if p_slug is null then raise exception 'slug is required for new content page'; end if;
    insert into public.content_pages (
      slug, title_ar, body_ar, faq_items, support_phone, support_whatsapp, is_active
    )
    values (
      p_slug, trim(p_title_ar), coalesce(p_body_ar, ''), p_faq_items,
      nullif(trim(p_support_phone), ''), nullif(trim(p_support_whatsapp), ''),
      coalesce(p_is_active, true)
    )
    returning id into v_id;
  else
    update public.content_pages
       set title_ar = trim(p_title_ar),
           body_ar = coalesce(p_body_ar, body_ar),
           faq_items = coalesce(p_faq_items, faq_items),
           support_phone = coalesce(nullif(trim(p_support_phone), ''), support_phone),
           support_whatsapp = coalesce(nullif(trim(p_support_whatsapp), ''), support_whatsapp),
           is_active = coalesce(p_is_active, is_active),
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.upsert_content_page_admin(uuid, public.content_page_slug, text, text, jsonb, text, text, boolean) from public, anon, authenticated;

-- ============================================================================
-- HOME SLIDERS
-- ============================================================================
create or replace function public.upsert_slider_admin(
  p_id            uuid    default null,
  p_title_ar      text    default null,
  p_subtitle_ar   text    default null,
  p_mobile_image  text    default null,
  p_desktop_image text    default null,
  p_price_label   text    default null,
  p_cta_label     text    default null,
  p_cta_target    public.slider_cta_target default 'package',
  p_cta_target_id text    default null,
  p_tests_count   int     default null,
  p_badge_ar      text    default null,
  p_display_order int     default 0,
  p_is_active     boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_text(p_title_ar, 'title_ar');

  if p_id is null then
    insert into public.home_sliders (
      title_ar, subtitle_ar, mobile_image, desktop_image, price_label,
      cta_label, cta_target, cta_target_id, tests_count, badge_ar,
      display_order, is_active
    )
    values (
      trim(p_title_ar), nullif(trim(p_subtitle_ar), ''),
      nullif(trim(p_mobile_image), ''), nullif(trim(p_desktop_image), ''),
      nullif(trim(p_price_label), ''), nullif(trim(p_cta_label), ''),
      p_cta_target, nullif(trim(p_cta_target_id), ''),
      p_tests_count, nullif(trim(p_badge_ar), ''),
      coalesce(p_display_order, 0), coalesce(p_is_active, true)
    )
    returning id into v_id;
  else
    update public.home_sliders
       set title_ar = trim(p_title_ar),
           subtitle_ar = nullif(trim(p_subtitle_ar), ''),
           mobile_image = nullif(trim(p_mobile_image), ''),
           desktop_image = nullif(trim(p_desktop_image), ''),
           price_label = nullif(trim(p_price_label), ''),
           cta_label = nullif(trim(p_cta_label), ''),
           cta_target = coalesce(p_cta_target, cta_target),
           cta_target_id = nullif(trim(p_cta_target_id), ''),
           tests_count = coalesce(p_tests_count, tests_count),
           badge_ar = nullif(trim(p_badge_ar), ''),
           display_order = coalesce(p_display_order, display_order),
           is_active = coalesce(p_is_active, is_active),
           updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.upsert_slider_admin(uuid, text, text, text, text, text, text, public.slider_cta_target, text, int, text, int, boolean) from public, anon, authenticated;

create or replace function public.delete_slider_admin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.home_sliders where id = p_id;
end;
$$;
revoke all on function public.delete_slider_admin(uuid) from public, anon, authenticated;
