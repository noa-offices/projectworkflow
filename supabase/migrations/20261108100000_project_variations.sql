begin;

-- Step C2a: apply a confirmed variation to its Project. The Project's original frozen copy (project_snapshots, Step B1) is never edited. Each applied
-- variation is saved here as immutable history, and the Project's current scope is the latest one. Payments are not touched: they keep the original
-- contract total until the next step.
--
-- project_variations: one row per applied variation. project_variation_sections and project_variation_items: every ACTIVE row of the variation at
-- that moment, with the complete original row in data. Rows are never edited or deleted. Writes only through apply_project_variation.
-- Read: whoever can read the Project's frozen copy, which in turn follows the source quotation.

create table public.project_variations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.project_snapshots(id) on delete restrict,
  order_no text not null,
  variation_no integer not null check (variation_no >= 1),
  -- on delete restrict: an applied variation cannot be deleted. Step A's lock already refuses this in the app.
  variation_quotation_id uuid not null unique references public.quotations(id) on delete restrict,
  variation_quotation_no text not null,
  base_revision_no integer not null,
  pricing_rule text not null check (pricing_rule in ('round_up_5_legacy','whole_aed_v1')),
  currency text not null,
  vat_percent numeric not null,
  subtotal numeric not null,
  discount_total numeric not null,
  overall_discount_type text,
  overall_discount_value numeric not null,
  vat_amount numeric not null,
  grand_total numeric not null,
  previous_contract_total numeric not null,
  new_contract_total numeric not null,
  contract_delta numeric not null,
  change_summary jsonb not null,
  layout_settings jsonb not null,
  quotation_data jsonb not null,
  -- No foreign key: history must never stop a user from being removed.
  applied_by uuid,
  applied_by_name text,
  applied_at timestamptz not null default clock_timestamp(),
  unique (snapshot_id, variation_no)
);
alter table public.project_variations enable row level security;

create table public.project_variation_sections (
  id uuid primary key default gen_random_uuid(),
  variation_id uuid not null references public.project_variations(id) on delete restrict,
  variation_section_id uuid not null,
  parent_section_id uuid,
  section_title text,
  section_notes text,
  section_kind text,
  section_type text,
  sort_order integer,
  data jsonb not null,
  unique (variation_id, variation_section_id)
);
alter table public.project_variation_sections enable row level security;

create table public.project_variation_items (
  id uuid primary key default gen_random_uuid(),
  variation_id uuid not null references public.project_variations(id) on delete restrict,
  -- The row id in the variation quotation.
  variation_item_id uuid not null,
  -- The id the same line had in the previous scope; null for a new line. Row ids change on every publish, so lines are matched at apply time.
  original_item_id uuid,
  variation_section_id uuid,
  parent_item_id uuid,
  source_template_id uuid,
  sort_order integer,
  item_type text not null,
  line_style text not null,
  is_rate_only boolean not null,
  is_optional boolean not null,
  include_in_total boolean not null,
  item_code text,
  item_name text,
  brand_name text,
  supplier_name text,
  specification text,
  specified_image_url text,
  proposed_image_url text,
  qty numeric not null,
  unit_label text,
  unit_price numeric not null,
  discount_type text,
  discount_value numeric not null,
  net_price numeric not null,
  net_total numeric not null,
  currency text,
  source_component_data jsonb,
  cell_layout jsonb,
  data jsonb not null,
  unique (variation_id, variation_item_id)
);
create unique index project_variation_items_one_line on public.project_variation_items(variation_id, original_item_id) where original_item_id is not null;
alter table public.project_variation_items enable row level security;

revoke all on public.project_variations, public.project_variation_sections, public.project_variation_items from public, anon, authenticated, service_role;
grant select on public.project_variations, public.project_variation_sections, public.project_variation_items to authenticated;

create policy project_variations_select_with_snapshot on public.project_variations for select to authenticated
  using (exists (select 1 from public.project_snapshots s where s.id = snapshot_id));
create policy project_variation_sections_select_with_variation on public.project_variation_sections for select to authenticated
  using (exists (select 1 from public.project_variations v where v.id = variation_id));
create policy project_variation_items_select_with_variation on public.project_variation_items for select to authenticated
  using (exists (select 1 from public.project_variations v where v.id = variation_id));

-- History is kept and never edited.
create function public.project_variations_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Applied variations are history and cannot be changed';
end $$;
revoke all on function public.project_variations_immutable() from public;
create trigger project_variations_no_change before update or delete on public.project_variations
  for each row execute function public.project_variations_immutable();
create trigger project_variations_no_truncate before truncate on public.project_variations
  for each statement execute function public.project_variations_immutable();
create trigger project_variation_sections_no_change before update or delete on public.project_variation_sections
  for each row execute function public.project_variations_immutable();
create trigger project_variation_sections_no_truncate before truncate on public.project_variation_sections
  for each statement execute function public.project_variations_immutable();
create trigger project_variation_items_no_change before update or delete on public.project_variation_items
  for each row execute function public.project_variations_immutable();
create trigger project_variation_items_no_truncate before truncate on public.project_variation_items
  for each statement execute function public.project_variations_immutable();

-- The grand total the copied items produce, both ways a stored total can have been calculated. The same rules as project_snapshot_item_grands.
create function public.project_variation_item_grands(p_variation_id uuid) returns table(rounded numeric, exact numeric) language sql stable set search_path='' as $$
  with s as (select * from public.project_variations where id = p_variation_id),
  lines as (
    select case when jsonb_typeof(s.layout_settings #> array['price_rounding','rounded_net_prices',i.variation_item_id::text]) = 'number'
      then (s.layout_settings #>> array['price_rounding','rounded_net_prices',i.variation_item_id::text])::numeric * i.qty
      else i.net_total end as net
    from public.project_variation_items i cross join s
    where i.variation_id = p_variation_id and not i.is_rate_only and (not i.is_optional or i.include_in_total)
      and i.line_style not in ('rate_only','no_quote','note','heading') and i.item_type not in ('note','blank','subtotal')
  ),
  sums as (select coalesce(sum(ceil(net / 5) * 5), 0) as r, coalesce(sum(round(net, 2)), 0) as e from lines),
  a as (select ceil(sums.r / 5) * 5 as r_net, sums.e as e_net, s.vat_percent as vat, s.overall_discount_value as v, s.overall_discount_type = 'percent' as is_percent from sums cross join s),
  b as (select *,
    ceil((case when is_percent then r_net * v / 100 else v end) / 5) * 5 as r_over,
    round(least(round(case when is_percent then e_net * least(greatest(v, 0), 100) / 100 else greatest(v, 0) end, 2), e_net), 2) as e_over
    from a),
  c as (select *, ceil(greatest(r_net - r_over, 0) / 5) * 5 as r_tax, round(greatest(e_net - e_over, 0), 2) as e_tax from b),
  d as (select *, ceil((r_tax * vat / 100) / 5) * 5 as r_vat, round(e_tax * greatest(vat, 0) / 100, 2) as e_vat from c)
  select ceil((r_tax + r_vat) / 5) * 5, round(e_tax + e_vat, 2) from d;
$$;
revoke all on function public.project_variation_item_grands(uuid) from public, anon, authenticated;

-- The same rule as project_snapshot_total_matches.
create function public.project_variation_total_matches(p_variation_id uuid, p_target numeric) returns boolean language sql stable set search_path='' as $$
  select case when v.pricing_rule = 'whole_aed_v1' then g.exact = p_target
    else g.rounded = p_target or abs(g.exact - p_target) <= 0.01 or ceil(g.exact / 5) * 5 = p_target end
  from public.project_variations v cross join public.project_variation_item_grands(p_variation_id) g
  where v.id = p_variation_id;
$$;
revoke all on function public.project_variation_total_matches(uuid, numeric) from public, anon, authenticated;

-- The rule Create Project File uses for the contract total (ruleExactAmount): whole AED is the exact total, legacy rounds up to 5.
create function public.project_variation_contract_total(p_rule text, p_grand_total numeric) returns numeric language sql immutable set search_path='' as $$
  select case when p_rule = 'whole_aed_v1' then round(p_grand_total, 2) else ceil(p_grand_total / 5) * 5 end;
$$;
revoke all on function public.project_variation_contract_total(text, numeric) from public, anon, authenticated;

create function public.project_variation_line(p_line_id uuid, p_row_id uuid, x jsonb) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('line_id', p_line_id, 'row_id', p_row_id, 'template_id', x->'source_template_id', 'item_code', x->'item_code_snapshot', 'item_name', x->'item_name_snapshot',
    'brand_name', x->'brand_name_snapshot', 'supplier_name', x->'supplier_name_snapshot', 'qty', x->'qty', 'unit_price', x->'unit_price', 'net_price', x->'net_price', 'net_total', x->'net_total');
$$;
revoke all on function public.project_variation_line(uuid, uuid, jsonb) from public, anon, authenticated;

-- The Project's current lines, in order: the latest applied variation, otherwise the original frozen copy.
create function public.project_variation_current_lines(p_snapshot_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare latest uuid; result jsonb;
begin
  select id into latest from public.project_variations where snapshot_id = p_snapshot_id order by variation_no desc limit 1;
  if latest is not null then
    select coalesce(jsonb_agg(public.project_variation_line(coalesce(i.original_item_id, i.variation_item_id), i.variation_item_id, i.data) order by i.sort_order, i.variation_item_id), '[]'::jsonb) into result
    from public.project_variation_items i where i.variation_id = latest;
  else
    select coalesce(jsonb_agg(public.project_variation_line(i.original_item_id, i.original_item_id, i.data) order by i.sort_order, i.original_item_id), '[]'::jsonb) into result
    from public.project_snapshot_items i where i.snapshot_id = p_snapshot_id;
  end if;
  return result;
end $$;
revoke all on function public.project_variation_current_lines(uuid) from public, anon, authenticated;

-- Which previous line each variation row is. Row ids are not stable, so lines match on what they are, strongest first, each previous line used once:
-- 1 same template, code and name; 2 same template and code; 3 same code; 4 same name. No match is a new line. Returns { variation row id: previous line id }.
create function public.project_variation_match_lines(p_previous jsonb, p_next jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare
  used jsonb := '{}'; result jsonb := '{}'; tier integer; n jsonb; p jsonb;
  has_template boolean; has_code boolean; has_name boolean;
begin
  for tier in 1..4 loop
    for n in select value from jsonb_array_elements(p_next) loop
      continue when result ? (n->>'row_id');
      has_template := coalesce(n->>'template_id', '') <> '';
      has_code := coalesce(btrim(n->>'item_code'), '') <> '';
      has_name := coalesce(btrim(n->>'item_name'), '') <> '';
      continue when (tier = 1 and not (has_template and has_code and has_name)) or (tier = 2 and not (has_template and has_code)) or (tier = 3 and not has_code) or (tier = 4 and not has_name);
      for p in select value from jsonb_array_elements(p_previous) loop
        continue when used ? (p->>'line_id');
        if (tier = 1 and p->>'template_id' = n->>'template_id' and p->>'item_code' = n->>'item_code' and p->>'item_name' = n->>'item_name')
          or (tier = 2 and p->>'template_id' = n->>'template_id' and p->>'item_code' = n->>'item_code')
          or (tier = 3 and p->>'item_code' = n->>'item_code')
          or (tier = 4 and p->>'item_name' = n->>'item_name') then
          used := used || jsonb_build_object(p->>'line_id', true);
          result := result || jsonb_build_object(n->>'row_id', p->>'line_id');
          exit;
        end if;
      end loop;
    end loop;
  end loop;
  return result;
end $$;
revoke all on function public.project_variation_match_lines(jsonb, jsonb) from public, anon, authenticated;

-- Added, removed and changed lines between two scopes.
create function public.project_variation_change_summary(p_previous jsonb, p_next jsonb, p_matches jsonb) returns jsonb language sql immutable set search_path='' as $$
  with prev as (select value as p from jsonb_array_elements(p_previous)),
  nxt as (select value as n from jsonb_array_elements(p_next)),
  paired as (select nxt.n, prev.p from nxt join prev on prev.p->>'line_id' = p_matches->>(nxt.n->>'row_id')),
  changed as (
    select jsonb_build_object('line_id', p->>'line_id', 'item_code', n->'item_code', 'item_name', n->'item_name', 'brand_name', n->'brand_name', 'supplier_name', n->'supplier_name',
      'item_name_before', p->'item_name', 'qty_before', p->'qty', 'qty', n->'qty', 'unit_price_before', p->'unit_price', 'unit_price', n->'unit_price', 'net_price_before', p->'net_price', 'net_price', n->'net_price',
      'net_total_before', p->'net_total', 'net_total', n->'net_total',
      'supplier_name_before', p->'supplier_name', 'brand_name_before', p->'brand_name') as c
    from paired
    where (p->'item_name', p->'item_code', p->'brand_name', p->'supplier_name') is distinct from (n->'item_name', n->'item_code', n->'brand_name', n->'supplier_name')
      or (p->>'qty')::numeric <> (n->>'qty')::numeric or (p->>'unit_price')::numeric <> (n->>'unit_price')::numeric
      or (p->>'net_price')::numeric <> (n->>'net_price')::numeric or (p->>'net_total')::numeric <> (n->>'net_total')::numeric
  )
  select jsonb_build_object(
    'added', coalesce((select jsonb_agg(n - 'line_id' - 'row_id' - 'template_id') from nxt where not p_matches ? (n->>'row_id')), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(p - 'row_id' - 'template_id') from prev where not exists (select 1 from paired x where x.p->>'line_id' = prev.p->>'line_id')), '[]'::jsonb),
    'changed', coalesce((select jsonb_agg(c) from changed), '[]'::jsonb),
    'unchanged_count', (select count(*) from paired) - (select count(*) from changed));
$$;
revoke all on function public.project_variation_change_summary(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- The checks shared by the preview and the apply. Not callable by users. Raises with the words the app maps to a message.
create function public.project_variation_check(q public.quotations, source public.quotations, snapshot public.project_snapshots, p_variation_no integer) returns void language plpgsql stable set search_path='' as $$
begin
  if not q.is_active or q.status <> 'client_confirmed' then raise exception 'Variation is not Client Confirmed'; end if;
  if source.layout_settings ? 'projectCancelledAt' or source.layout_settings ? 'projectCompletedAt' then raise exception 'Project is cancelled or completed'; end if;
  if p_variation_no <= coalesce((select max(v.variation_no) from public.project_variations v where v.snapshot_id = snapshot.id), 0) then raise exception 'Variation is out of order'; end if;
  -- Numbers run in order. A rejected, cancelled or archived variation never reaches the Project, so it does not hold up the next one.
  if exists (
    select 1 from public.quotations o
    where o.client_id = q.client_id and o.id <> q.id
      and upper(o.layout_settings #>> '{variationOf,orderNo}') = upper(snapshot.order_no)
      and (o.layout_settings #>> '{variationOf,variationNo}')::integer < p_variation_no
      and not (o.layout_settings ? 'variationApplied')
      and o.is_active and o.status not in ('cancelled','archived')
  ) then raise exception 'Variation is out of order'; end if;
end $$;
revoke all on function public.project_variation_check(public.quotations, public.quotations, public.project_snapshots, integer) from public, anon, authenticated;

-- What Update Project File would do, without doing it: the change summary and the totals, for the confirm step.
create function public.project_variation_preview(p_variation_quotation_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  q public.quotations%rowtype; source public.quotations%rowtype; snapshot public.project_snapshots%rowtype;
  previous_lines jsonb; next_lines jsonb; matches jsonb; rule text; previous_total numeric; new_total numeric;
begin
  if auth.uid() is null or not public.current_user_is_active()
    or public.current_user_role()::text not in ('system_owner','admin_manager','sales_designer','sales_coordinator','designer') then
    raise insufficient_privilege;
  end if;
  select * into q from public.quotations where id = p_variation_quotation_id;
  if q.id is null or jsonb_typeof(q.layout_settings->'variationOf') <> 'object' then raise exception 'This is not a variation'; end if;
  select * into source from public.quotations where id::text = q.layout_settings #>> '{variationOf,projectQuotationId}';
  select * into snapshot from public.project_snapshots where quotation_id = source.id and id::text = q.layout_settings #>> '{variationOf,snapshotId}';
  if snapshot.id is null then raise exception 'Project has no frozen copy'; end if;
  perform public.project_variation_check(q, source, snapshot, (q.layout_settings #>> '{variationOf,variationNo}')::integer);
  previous_lines := public.project_variation_current_lines(snapshot.id);
  select coalesce(jsonb_agg(public.project_variation_line(x.id, x.id, to_jsonb(x)) order by x.sort_order, x.id), '[]'::jsonb) into next_lines
    from public.quotation_items x where x.quotation_id = q.id and x.is_active;
  matches := public.project_variation_match_lines(previous_lines, next_lines);
  rule := case when q.layout_settings->>'pricing_rule' = 'whole_aed_v1' then 'whole_aed_v1' else 'round_up_5_legacy' end;
  select coalesce((select v.new_contract_total from public.project_variations v where v.snapshot_id = snapshot.id order by v.variation_no desc limit 1), snapshot.contract_total) into previous_total;
  new_total := public.project_variation_contract_total(rule, q.grand_total);
  return jsonb_build_object('change_summary', public.project_variation_change_summary(previous_lines, next_lines, matches),
    'previous_contract_total', previous_total, 'new_contract_total', new_total, 'contract_delta', new_total - previous_total, 'currency', q.currency, 'pricing_rule', rule);
end $$;
revoke all on function public.project_variation_preview(uuid) from public, anon;
grant execute on function public.project_variation_preview(uuid) to authenticated;

-- Update Project File. Everything below happens together or not at all: the copy, the check, the audit row and the mark on the variation. A second call returns the same row.
create function public.apply_project_variation(p_variation_quotation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  link jsonb; source_id uuid; variation_no integer;
  q public.quotations%rowtype; source public.quotations%rowtype; snapshot public.project_snapshots%rowtype;
  existing uuid; new_id uuid; actor text; previous_lines jsonb; next_lines jsonb; matches jsonb; summary jsonb;
  rule text; previous_total numeric; new_total numeric; applied_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not public.current_user_is_active()
    or public.current_user_role()::text not in ('system_owner','admin_manager','sales_designer','sales_coordinator','designer') then
    raise insufficient_privilege;
  end if;
  select q0.layout_settings->'variationOf' into link from public.quotations q0 where q0.id = p_variation_quotation_id;
  if jsonb_typeof(link) is distinct from 'object' or jsonb_typeof(link->'variationNo') is distinct from 'number'
    or coalesce(link->>'projectQuotationId', '') !~ '^[0-9a-fA-F-]{36}$' or coalesce(link->>'snapshotId', '') !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'This is not a variation';
  end if;
  source_id := (link->>'projectQuotationId')::uuid;
  variation_no := (link->>'variationNo')::integer;

  -- The Project first, then the variation: every apply locks in the same order.
  select * into source from public.quotations where id = source_id for update;
  select * into q from public.quotations where id = p_variation_quotation_id for update;
  select id into existing from public.project_variations where variation_quotation_id = q.id;
  if existing is not null then return jsonb_build_object('id', existing, 'created', false); end if;
  select * into snapshot from public.project_snapshots where quotation_id = source_id and id = (link->>'snapshotId')::uuid;
  if source.id is null or snapshot.id is null then raise exception 'Project has no frozen copy'; end if;
  perform public.project_variation_check(q, source, snapshot, variation_no);

  previous_lines := public.project_variation_current_lines(snapshot.id);
  select coalesce(jsonb_agg(public.project_variation_line(x.id, x.id, to_jsonb(x)) order by x.sort_order, x.id), '[]'::jsonb) into next_lines
    from public.quotation_items x where x.quotation_id = q.id and x.is_active;
  matches := public.project_variation_match_lines(previous_lines, next_lines);
  summary := public.project_variation_change_summary(previous_lines, next_lines, matches);
  rule := case when q.layout_settings->>'pricing_rule' = 'whole_aed_v1' then 'whole_aed_v1' else 'round_up_5_legacy' end;
  select coalesce((select v.new_contract_total from public.project_variations v where v.snapshot_id = snapshot.id order by v.variation_no desc limit 1), snapshot.contract_total) into previous_total;
  new_total := public.project_variation_contract_total(rule, q.grand_total);
  select nullif(btrim(p.full_name), '') into actor from public.profiles p where p.id = auth.uid();

  insert into public.project_variations(snapshot_id, order_no, variation_no, variation_quotation_id, variation_quotation_no, base_revision_no, pricing_rule, currency, vat_percent, subtotal, discount_total,
    overall_discount_type, overall_discount_value, vat_amount, grand_total, previous_contract_total, new_contract_total, contract_delta, change_summary, layout_settings, quotation_data, applied_by, applied_by_name, applied_at)
  values(snapshot.id, snapshot.order_no, variation_no, q.id, q.quotation_no, coalesce((link->>'baseRevisionNo')::integer, snapshot.revision_no), rule, q.currency, q.vat_percent, q.subtotal, q.discount_total,
    q.overall_discount_type, q.overall_discount_value, q.vat_amount, q.grand_total, previous_total, new_total, new_total - previous_total, summary, q.layout_settings, to_jsonb(q), auth.uid(), actor, applied_at)
  returning id into new_id;

  insert into public.project_variation_sections(variation_id, variation_section_id, parent_section_id, section_title, section_notes, section_kind, section_type, sort_order, data)
  select new_id, x.id, x.parent_section_id, x.section_title, x.section_notes, x.section_kind, x.section_type, x.sort_order, to_jsonb(x)
  from public.quotation_sections x where x.quotation_id = q.id and x.is_active;

  insert into public.project_variation_items(variation_id, variation_item_id, original_item_id, variation_section_id, parent_item_id, source_template_id, sort_order, item_type, line_style, is_rate_only,
    is_optional, include_in_total, item_code, item_name, brand_name, supplier_name, specification, specified_image_url, proposed_image_url, qty, unit_label, unit_price, discount_type, discount_value,
    net_price, net_total, currency, source_component_data, cell_layout, data)
  select new_id, x.id, (matches->>(x.id::text))::uuid, x.section_id, x.parent_item_id, x.source_template_id, x.sort_order, x.item_type, x.line_style, x.is_rate_only,
    x.is_optional, x.include_in_total, x.item_code_snapshot, x.item_name_snapshot, x.brand_name_snapshot, x.supplier_name_snapshot, x.specification_snapshot, x.specified_image_url_snapshot, x.proposed_image_url_snapshot,
    x.qty, x.unit_label, x.unit_price, x.discount_type, x.discount_value, x.net_price, x.net_total, x.currency, x.source_component_data, x.cell_layout, to_jsonb(x)
  from public.quotation_items x where x.quotation_id = q.id and x.is_active;

  -- The copy must add up to the variation's stored total, or nothing is saved.
  if not public.project_variation_total_matches(new_id, q.grand_total) then
    raise exception 'The copied items do not add up to the stored variation total';
  end if;

  update public.quotations set layout_settings = layout_settings || jsonb_build_object('variationApplied',
    jsonb_build_object('orderNo', snapshot.order_no, 'variationNo', variation_no, 'appliedAt', applied_at, 'projectVariationId', new_id)) where id = q.id;

  insert into public.audit_activity_log(entity_type,entity_id,action,title,description,metadata,created_by)
    values('quotation', q.id, 'project_variation_applied', 'Variation applied to Project', q.quotation_no || ' applied to ' || snapshot.order_no,
      jsonb_build_object('orderNo', snapshot.order_no, 'variation_id', new_id, 'variation_no', variation_no, 'previous_contract_total', previous_total, 'new_contract_total', new_total), auth.uid());
  return jsonb_build_object('id', new_id, 'created', true);
end $$;
revoke all on function public.apply_project_variation(uuid) from public, anon;
grant execute on function public.apply_project_variation(uuid) to authenticated;

-- For lists: the latest applied variation of each quotation. Security invoker on purpose: the table policies apply. A Project with no applied variation reports null.
create function public.project_variation_state(p_quotation_ids uuid[]) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null or not public.current_user_is_active() then raise insufficient_privilege; end if;
  if p_quotation_ids is null or cardinality(p_quotation_ids) not between 1 and 50 then raise exception 'Choose between 1 and 50 quotations'; end if;
  return (select jsonb_agg(jsonb_build_object('quotation_id', x.id, 'applied_variation_no', l.variation_no, 'contract_total', l.new_contract_total, 'original_contract_total', s.contract_total) order by x.id)
    from (select distinct unnest(p_quotation_ids) as id) x
    left join public.project_snapshots s on s.quotation_id = x.id
    left join lateral (select v.variation_no, v.new_contract_total from public.project_variations v where v.snapshot_id = s.id order by v.variation_no desc limit 1) l on true);
end $$;
revoke all on function public.project_variation_state(uuid[]) from public, anon;
grant execute on function public.project_variation_state(uuid[]) to authenticated;

commit;
