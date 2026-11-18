-- Product Gallery (stage A, database): a COMPANY-WIDE library of configured products that grows by itself.
-- When a quotation moves out of draft to any status except cancelled or archived, its configured product lines (a saved configuration recipe is required) are added here.
-- What is kept: the product, a price-free STRUCTURAL recipe (a fixed list of allowed keys; typed text, finishes, spec text, linked-product
-- instances, discounts, prices, client names and quote numbers are never kept), a name, tags, and a "quoted in N quotations" counter.
-- The same configuration is stored once (identity = template + sha256 of the cleaned recipe). Each quotation counts once per configuration.
-- Which quotation counted is remembered in a separate table that NO user can read. Prices are NOT stored: they are worked out from the current price list later.
-- Users (sales roles) get SELECT only. Hiding / renaming / tagging / merging go through SECURITY DEFINER functions for system_owner and admin_manager only.
-- NOT applied automatically.

-- A. Who may see the gallery / who may curate it.
create or replace function public.product_gallery_can_view()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_is_active()
    and public.current_user_role() in ('system_owner','admin_manager','sales_designer','sales_coordinator','designer'), false);
$$;
create or replace function public.product_gallery_is_curator()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_is_active() and public.current_user_role() in ('system_owner','admin_manager'), false);
$$;

-- B. Tables.
create table if not exists public.product_gallery_items (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique check (char_length(identity_key) between 10 and 160),
  template_id uuid not null references public.product_templates(id) on delete cascade,
  brand_id uuid,
  main_category_id uuid,
  sub_category_id uuid,
  item_name text not null check (char_length(btrim(item_name)) between 1 and 300),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  item_code text check (item_code is null or char_length(item_code) <= 80),
  currency text check (currency is null or char_length(currency) <= 8),
  recipe jsonb not null check (jsonb_typeof(recipe) = 'object' and octet_length(recipe::text) <= 65536),
  search_text text not null default '' check (char_length(search_text) <= 800),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  quoted_count integer not null default 1 check (quoted_count >= 1),
  first_quoted_at timestamptz not null default now(),
  last_quoted_at timestamptz not null default now(),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists product_gallery_items_template_idx on public.product_gallery_items (template_id);
create index if not exists product_gallery_items_popular_idx on public.product_gallery_items (is_hidden, quoted_count desc, last_quoted_at desc);

-- Which quotation already counted for which configuration (so re-sending a quotation never counts twice). Nobody can read it.
create table if not exists public.product_gallery_sources (
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  identity_key text not null,
  created_at timestamptz not null default now(),
  primary key (quotation_id, identity_key)
);

-- C. Rights and RLS.
alter table public.product_gallery_items enable row level security;
alter table public.product_gallery_sources enable row level security;
revoke all on public.product_gallery_items from public, anon, authenticated;
revoke all on public.product_gallery_sources from public, anon, authenticated;
grant select on public.product_gallery_items to authenticated;
drop policy if exists product_gallery_items_select on public.product_gallery_items;
create policy product_gallery_items_select on public.product_gallery_items for select to authenticated
  using (public.product_gallery_can_view() and (not is_hidden or public.product_gallery_is_curator()));

-- D. Clean a saved recipe into a STRUCTURAL one. Returns NULL when the line is too specific to share (typed required-component overrides,
-- linked-product instances, unexpected shapes, long free text, forbidden price/discount/cost keys). Everything not in the allow-list is dropped.
create or replace function public.product_gallery_clean_recipe(p_recipe jsonb, p_template uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  s jsonb; l jsonb; sel jsonb; k text; v jsonb; skipped jsonb; res jsonb;
begin
  if p_recipe is null or p_template is null or jsonb_typeof(p_recipe) <> 'object' then return null; end if;
  if (p_recipe->>'template_id') is distinct from p_template::text then return null; end if;
  s := coalesce(p_recipe->'selections', '{}'::jsonb);
  l := coalesce(p_recipe->'linked', '{}'::jsonb);
  if jsonb_typeof(s) <> 'object' or jsonb_typeof(l) <> 'object' then return null; end if;
  if coalesce(s->'required_overrides', '{}'::jsonb) <> '{}'::jsonb then return null; end if;
  if coalesce(l->'instances', '{}'::jsonb) <> '{}'::jsonb then return null; end if;

  sel := '{}'::jsonb;
  foreach k in array array['category_row_id', 'fabric_category', 'category_group_id'] loop
    v := s->k;
    if v is not null and jsonb_typeof(v) = 'string' then sel := sel || jsonb_build_object(k, v);
    elsif v is not null and jsonb_typeof(v) <> 'null' then return null; end if;
  end loop;
  foreach k in array array['modular_quantities', 'pricing_accessory_quantities', 'component_accessory_quantities', 'component_option_selections', 'accessory_category_choices'] loop
    v := coalesce(s->k, '{}'::jsonb);
    if jsonb_typeof(v) <> 'object' then return null; end if;
    sel := sel || jsonb_build_object(k, v);
  end loop;
  v := coalesce(s->'skipped_accessory_group_ids', '[]'::jsonb);
  if jsonb_typeof(v) <> 'array' then return null; end if;
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into skipped from (select distinct jsonb_array_elements_text(v) as x) t;
  sel := sel || jsonb_build_object('skipped_accessory_group_ids', skipped);

  v := coalesce(l->'selections', '{}'::jsonb);
  if jsonb_typeof(v) <> 'object' then return null; end if;

  res := jsonb_build_object(
    'recipe_version', 1,
    'template_id', p_template,
    'selections', sel,
    'linked', jsonb_build_object('selections', v));

  if octet_length(res::text) > 65536 then return null; end if;
  -- no long typed text anywhere, and no forbidden (price / discount / cost ...) key
  if jsonb_path_exists(res, '$.** ? (@.type() == "string" && @ like_regex "^.{121,}")') then return null; end if;
  if public.my_collection_json_forbidden_key(res) then return null; end if;
  return res;
end $$;

-- E. Record one quotation. Internal: only the trigger calls it. Returns how many configurations were counted.
create or replace function public.product_gallery_record(p_quotation_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_clean jsonb; v_key text; v_rows integer; v_counted integer := 0;
begin
  if not exists (select 1 from public.quotations where id = p_quotation_id and is_active and status not in ('draft', 'cancelled', 'archived')) then return 0; end if;
  for r in
    select i.source_template_id as template_id, i.source_component_data->'configuration_recipe'->'recipe' as recipe
      from public.quotation_items i
     where i.quotation_id = p_quotation_id and i.is_active and i.item_type = 'product' and i.source_template_id is not null
       and i.parent_item_id is null and i.include_in_total and not i.is_rate_only
       and coalesce(i.line_style, '') not in ('heading', 'note', 'no_quote')
       and jsonb_typeof(i.source_component_data->'configuration_recipe'->'recipe') = 'object'
  loop
    v_clean := public.product_gallery_clean_recipe(r.recipe, r.template_id);
    continue when v_clean is null;
    -- only an active product with an active lifecycle can be in the gallery
    perform 1 from public.product_templates t where t.id = r.template_id and t.is_active and t.lifecycle_status = 'active';
    continue when not found;
    v_key := 'g:' || r.template_id::text || ':' || encode(sha256(convert_to(v_clean::text, 'utf8')), 'hex');

    insert into public.product_gallery_sources (quotation_id, identity_key) values (p_quotation_id, v_key) on conflict do nothing;
    get diagnostics v_rows = row_count;
    continue when v_rows = 0;   -- this quotation already counted this configuration

    insert into public.product_gallery_items (identity_key, template_id, brand_id, main_category_id, sub_category_id, item_name, item_code, currency, recipe, search_text)
    select v_key, t.id, t.brand_id, t.main_category_id, t.sub_category_id,
           left(coalesce(nullif(btrim(t.template_name), ''), nullif(btrim(t.internal_selection_name), ''), 'Product'), 300),
           left(nullif(btrim(t.item_code), ''), 80), left(nullif(btrim(t.currency), ''), 8), v_clean,
           left(btrim(regexp_replace(lower(coalesce(t.template_name, '') || ' ' || coalesce(t.internal_selection_name, '') || ' ' || coalesce(t.item_code, '')), '[^a-z0-9]+', ' ', 'g')), 800)
      from public.product_templates t
     where t.id = r.template_id and t.is_active and t.lifecycle_status = 'active'
    on conflict (identity_key) do update set
      quoted_count = public.product_gallery_items.quoted_count + 1,
      last_quoted_at = now(),
      brand_id = excluded.brand_id, main_category_id = excluded.main_category_id, sub_category_id = excluded.sub_category_id,
      item_name = excluded.item_name, item_code = excluded.item_code, currency = excluded.currency, search_text = excluded.search_text;
    v_counted := v_counted + 1;
  end loop;
  return v_counted;
end $$;
revoke all on function public.product_gallery_record(uuid) from public, anon, authenticated;
revoke all on function public.product_gallery_clean_recipe(jsonb, uuid) from public, anon, authenticated;

-- F. Trigger: a status change to anything except draft, cancelled or archived. Never blocks the status change.
create or replace function public.product_gallery_on_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public.product_gallery_record(new.id);
  exception when others then
    null;
  end;
  return new;
end $$;
revoke all on function public.product_gallery_on_status() from public, anon, authenticated;
drop trigger if exists quotations_record_product_gallery on public.quotations;
create trigger quotations_record_product_gallery after update of status on public.quotations
  for each row when (new.status <> all (array['draft', 'cancelled', 'archived']) and old.status is distinct from new.status)
  execute function public.product_gallery_on_status();

-- G. Curation (system_owner / admin_manager only).
create or replace function public.product_gallery_set_hidden(p_id uuid, p_hidden boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.product_gallery_is_curator() then raise exception 'Not allowed.'; end if;
  update public.product_gallery_items set is_hidden = coalesce(p_hidden, false) where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.product_gallery_update_details(p_id uuid, p_display_name text, p_tags text[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer; v_tags text[]; v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if not public.product_gallery_is_curator() then raise exception 'Not allowed.'; end if;
  if v_name is not null and char_length(v_name) > 120 then raise exception 'Name is too long.'; end if;
  select coalesce(array_agg(distinct t order by t), '{}') into v_tags
    from (select left(lower(btrim(x)), 30) as t from unnest(coalesce(p_tags, '{}')) as x) q where t <> '';
  if cardinality(v_tags) > 20 then raise exception 'Too many tags.'; end if;
  update public.product_gallery_items set display_name = v_name, tags = v_tags where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Merge a duplicate into another item: counts are added, the duplicate is removed, its quotation records move over.
create or replace function public.product_gallery_merge(p_from uuid, p_to uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f record; t record;
begin
  if not public.product_gallery_is_curator() then raise exception 'Not allowed.'; end if;
  if p_from is null or p_to is null or p_from = p_to then return false; end if;
  select * into f from public.product_gallery_items where id = p_from for update;
  select * into t from public.product_gallery_items where id = p_to for update;
  if f.id is null or t.id is null then return false; end if;
  delete from public.product_gallery_sources s where s.identity_key = f.identity_key
     and exists (select 1 from public.product_gallery_sources x where x.quotation_id = s.quotation_id and x.identity_key = t.identity_key);
  update public.product_gallery_sources set identity_key = t.identity_key where identity_key = f.identity_key;
  update public.product_gallery_items set quoted_count = t.quoted_count + f.quoted_count,
         last_quoted_at = greatest(t.last_quoted_at, f.last_quoted_at), first_quoted_at = least(t.first_quoted_at, f.first_quoted_at),
         tags = (select coalesce(array_agg(distinct x), '{}') from unnest(t.tags || f.tags) x)
   where id = p_to;
  delete from public.product_gallery_items where id = p_from;
  return true;
end $$;

revoke all on function public.product_gallery_set_hidden(uuid, boolean) from public, anon;
revoke all on function public.product_gallery_update_details(uuid, text, text[]) from public, anon;
revoke all on function public.product_gallery_merge(uuid, uuid) from public, anon;
revoke all on function public.product_gallery_can_view() from public, anon;
revoke all on function public.product_gallery_is_curator() from public, anon;
grant execute on function public.product_gallery_set_hidden(uuid, boolean) to authenticated;
grant execute on function public.product_gallery_update_details(uuid, text, text[]) to authenticated;
grant execute on function public.product_gallery_merge(uuid, uuid) to authenticated;
grant execute on function public.product_gallery_can_view() to authenticated;
grant execute on function public.product_gallery_is_curator() to authenticated;
