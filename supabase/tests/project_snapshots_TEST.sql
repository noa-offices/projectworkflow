-- RUN FIRST: Step B1 preview. The migration and the checks are fully rolled back. Nothing is saved, and no snapshot is created.
begin;

-- Step B1 of "the Project keeps its own copy". A frozen copy of the approved quotation, taken when the Project File is created, plus a one-time
-- copy for existing Projects. Nothing reads these tables yet (that is B2) and nothing here changes a quotation (a database guard is B3).
-- "projects" is the CRM client folder and is not used here, apart from copying its contact fields.
--
-- project_snapshots: one header per Project. project_snapshot_sections and project_snapshot_items: every ACTIVE row at that moment, with the
-- complete original row in data. Old rows are never edited or deleted. Writes only through the SECURITY DEFINER functions below.
-- Read: whoever can read the source quotation today. The policies look the quotation up, so its own RLS decides.

create table public.project_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- on delete restrict: a quotation with a snapshot cannot be deleted. Step A already refuses to delete a locked quotation in the app.
  quotation_id uuid not null unique references public.quotations(id) on delete restrict,
  order_no text not null unique check (order_no ~ '\S'),
  quotation_no text not null,
  revision_no integer not null,
  option_no integer,
  project_file jsonb not null,
  pricing_rule text not null check (pricing_rule in ('round_up_5_legacy','whole_aed_v1')),
  currency text not null,
  vat_percent numeric not null,
  subtotal numeric not null,
  discount_total numeric not null,
  overall_discount_type text,
  overall_discount_value numeric not null,
  -- quotations has no net_total column: this is the stored grand_total minus the stored vat_amount, so it recalculates nothing.
  net_total numeric not null,
  vat_amount numeric not null,
  grand_total numeric not null,
  -- The frozen contract amount: projectFile.total. Legacy rounds up to 5, so it can differ from grand_total.
  contract_total numeric not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  client_name text,
  client_number text,
  client_contact_person text,
  client_email text,
  client_phone text,
  client_address text,
  client_city text,
  client_country text,
  client_trn text,
  client_data jsonb not null,
  -- The CRM folder as it was. No foreign key: the snapshot must not tie itself to the projects table.
  crm_project_id uuid,
  project_name text,
  project_location text,
  attention_to text,
  attention_mobile text,
  attention_landline text,
  attention_email text,
  po_box text,
  project_address text,
  project_data jsonb,
  quotation_title text,
  quotation_date date,
  legacy_reference text,
  payment_terms text,
  validity text,
  delivery_terms text,
  warranty_terms text,
  notes text,
  layout_mode text,
  layout_settings jsonb not null,
  quotation_data jsonb not null,
  source_method text not null check (source_method in ('created_with_project_file','backfilled_from_live_quotation')),
  -- No foreign key: history must never stop a user from being removed.
  created_by uuid,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.project_snapshots enable row level security;

create table public.project_snapshot_sections (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.project_snapshots(id) on delete restrict,
  original_section_id uuid not null,
  original_parent_section_id uuid,
  section_title text,
  section_notes text,
  section_kind text,
  section_type text,
  sort_order integer,
  data jsonb not null,
  unique (snapshot_id, original_section_id)
);
alter table public.project_snapshot_sections enable row level security;

create table public.project_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.project_snapshots(id) on delete restrict,
  original_item_id uuid not null,
  -- Original ids only, with no foreign key: deleting a product template or an old row must not touch history.
  original_section_id uuid,
  original_parent_item_id uuid,
  source_template_id uuid,
  sort_order integer,
  item_type text not null,
  line_style text not null,
  is_rate_only boolean not null,
  is_optional boolean not null,
  include_in_total boolean not null,
  manual_serial text,
  item_code text,
  item_name text,
  brand_name text,
  category_name text,
  supplier_name text,
  supplier_notes text,
  model text,
  finish text,
  size text,
  origin text,
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
  unique (snapshot_id, original_item_id)
);
create index project_snapshot_items_template on public.project_snapshot_items(source_template_id);
alter table public.project_snapshot_items enable row level security;

revoke all on public.project_snapshots, public.project_snapshot_sections, public.project_snapshot_items from public, anon, authenticated, service_role;
grant select on public.project_snapshots, public.project_snapshot_sections, public.project_snapshot_items to authenticated;

create policy project_snapshots_select_with_quotation on public.project_snapshots for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id));
create policy project_snapshot_sections_select_with_quotation on public.project_snapshot_sections for select to authenticated
  using (exists (select 1 from public.project_snapshots s where s.id = snapshot_id));
create policy project_snapshot_items_select_with_quotation on public.project_snapshot_items for select to authenticated
  using (exists (select 1 from public.project_snapshots s where s.id = snapshot_id));

-- History is kept and never edited.
create function public.project_snapshots_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Project snapshots are history and cannot be changed';
end $$;
revoke all on function public.project_snapshots_immutable() from public;
create trigger project_snapshots_no_change before update or delete on public.project_snapshots
  for each row execute function public.project_snapshots_immutable();
create trigger project_snapshots_no_truncate before truncate on public.project_snapshots
  for each statement execute function public.project_snapshots_immutable();
create trigger project_snapshot_sections_no_change before update or delete on public.project_snapshot_sections
  for each row execute function public.project_snapshots_immutable();
create trigger project_snapshot_sections_no_truncate before truncate on public.project_snapshot_sections
  for each statement execute function public.project_snapshots_immutable();
create trigger project_snapshot_items_no_change before update or delete on public.project_snapshot_items
  for each row execute function public.project_snapshots_immutable();
create trigger project_snapshot_items_no_truncate before truncate on public.project_snapshot_items
  for each statement execute function public.project_snapshots_immutable();

-- The same rule as projectFileRecordValue in lib/quotations/project-file.ts: the required text fields are not blank and total is a number.
create function public.project_snapshot_valid_file(p_layout jsonb) returns jsonb language sql immutable set search_path='' as $$
  select case
    when jsonb_typeof(x.f) = 'object' and jsonb_typeof(x.f->'total') = 'number'
      and (select bool_and(jsonb_typeof(x.f->k) = 'string' and (x.f->>k) ~ '\S')
           from unnest(array['orderNo','quotationId','quotationNo','clientId','clientName','reference','currency','createdAt','createdBy']) k)
    then x.f end
  from (select case when jsonb_typeof(p_layout) = 'object' then p_layout->'projectFile' end as f) x;
$$;
revoke all on function public.project_snapshot_valid_file(jsonb) from public, anon, authenticated;

-- The grand total the copied items produce, both ways a stored total can have been calculated. Only the lines that count towards totals, as in
-- recalculateQuotationTotals. A line rounded by the Price Rounding box counts at its rounded net. Mirrors lib/quotations/project-snapshot.ts.
create function public.project_snapshot_item_grands(p_snapshot_id uuid) returns table(rounded numeric, exact numeric) language sql stable set search_path='' as $$
  with s as (select * from public.project_snapshots where id = p_snapshot_id),
  lines as (
    select case when jsonb_typeof(s.layout_settings #> array['price_rounding','rounded_net_prices',i.original_item_id::text]) = 'number'
      then (s.layout_settings #>> array['price_rounding','rounded_net_prices',i.original_item_id::text])::numeric * i.qty
      else i.net_total end as net
    from public.project_snapshot_items i cross join s
    where i.snapshot_id = p_snapshot_id and not i.is_rate_only and (not i.is_optional or i.include_in_total)
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
revoke all on function public.project_snapshot_item_grands(uuid) from public, anon, authenticated;

-- The totals-match rule, mirrored in snapshotTotalsMatch. Whole AED: the exact total, to the cent.
-- Legacy has two calculations. The shared builder rounds up to 5. The local builder is exact but in binary fractions, so it may be 0.01 away.
-- A legacy Project File total is that exact total rounded up to 5, which also counts.
create function public.project_snapshot_total_matches(p_snapshot_id uuid, p_target numeric) returns boolean language sql stable set search_path='' as $$
  select case when s.pricing_rule = 'whole_aed_v1' then g.exact = p_target
    else g.rounded = p_target or abs(g.exact - p_target) <= 0.01 or ceil(g.exact / 5) * 5 = p_target end
  from public.project_snapshots s cross join public.project_snapshot_item_grands(p_snapshot_id) g
  where s.id = p_snapshot_id;
$$;
revoke all on function public.project_snapshot_total_matches(uuid, numeric) from public, anon, authenticated;

-- Shared by create and backfill: locks the quotation and copies header, sections and items in one transaction. Not callable by users.
create function public.project_snapshot_copy(p_quotation_id uuid, p_source_method text) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  q public.quotations%rowtype;
  c public.clients%rowtype;
  p public.projects%rowtype;
  file jsonb;
  existing uuid;
  new_id uuid;
  item_count integer;
begin
  select * into q from public.quotations where id = p_quotation_id for update;
  if q.id is null then raise exception 'Quotation unavailable'; end if;
  select id into existing from public.project_snapshots where quotation_id = q.id;
  if existing is not null then return jsonb_build_object('id', existing, 'created', false); end if;
  file := public.project_snapshot_valid_file(q.layout_settings);
  if file is null then raise exception 'This quotation has no valid Project File'; end if;
  -- A revision made before Step A can carry its source's Project File. That Project belongs to the source.
  if file->>'quotationId' <> q.id::text then raise exception 'This Project File belongs to another quotation'; end if;
  select * into c from public.clients where id = q.client_id;
  if c.id is null then raise exception 'Client unavailable'; end if;
  select * into p from public.projects where id = q.project_id;

  insert into public.project_snapshots(quotation_id, order_no, quotation_no, revision_no, option_no, project_file, pricing_rule, currency, vat_percent, subtotal, discount_total,
    overall_discount_type, overall_discount_value, net_total, vat_amount, grand_total, contract_total, client_id, client_name, client_number, client_contact_person, client_email,
    client_phone, client_address, client_city, client_country, client_trn, client_data, crm_project_id, project_name, project_location, attention_to, attention_mobile, attention_landline,
    attention_email, po_box, project_address, project_data, quotation_title, quotation_date, legacy_reference, payment_terms, validity, delivery_terms, warranty_terms, notes, layout_mode,
    layout_settings, quotation_data, source_method, created_by)
  values(q.id, file->>'orderNo', q.quotation_no, q.revision_no, q.option_no, file,
    case when q.layout_settings->>'pricing_rule' = 'whole_aed_v1' then 'whole_aed_v1' else 'round_up_5_legacy' end,
    q.currency, q.vat_percent, q.subtotal, q.discount_total, q.overall_discount_type, q.overall_discount_value, q.grand_total - q.vat_amount, q.vat_amount, q.grand_total,
    (file->>'total')::numeric, q.client_id, c.company_name, c.client_number, c.contact_person, c.email, c.phone, c.address, c.city, c.country, c.trn, to_jsonb(c),
    q.project_id, p.project_name, p.location, p.attention_to, p.attention_mobile, p.attention_landline, p.attention_email, p.po_box, p.project_address,
    case when p.id is null then null else to_jsonb(p) end,
    q.title, q.quotation_date, q.legacy_reference, q.payment_terms, q.validity, q.delivery_terms, q.warranty_terms, q.notes, q.layout_mode, q.layout_settings, to_jsonb(q),
    p_source_method, auth.uid())
  returning id into new_id;

  insert into public.project_snapshot_sections(snapshot_id, original_section_id, original_parent_section_id, section_title, section_notes, section_kind, section_type, sort_order, data)
  select new_id, x.id, x.parent_section_id, x.section_title, x.section_notes, x.section_kind, x.section_type, x.sort_order, to_jsonb(x)
  from public.quotation_sections x where x.quotation_id = q.id and x.is_active;

  insert into public.project_snapshot_items(snapshot_id, original_item_id, original_section_id, original_parent_item_id, source_template_id, sort_order, item_type, line_style, is_rate_only,
    is_optional, include_in_total, manual_serial, item_code, item_name, brand_name, category_name, supplier_name, supplier_notes, model, finish, size, origin, specification,
    specified_image_url, proposed_image_url, qty, unit_label, unit_price, discount_type, discount_value, net_price, net_total, currency, source_component_data, cell_layout, data)
  select new_id, x.id, x.section_id, x.parent_item_id, x.source_template_id, x.sort_order, x.item_type, x.line_style, x.is_rate_only,
    x.is_optional, x.include_in_total, x.manual_serial, x.item_code_snapshot, x.item_name_snapshot, x.brand_name_snapshot, x.category_name_snapshot, x.supplier_name_snapshot, x.supplier_notes_snapshot,
    x.model_snapshot, x.finish_snapshot, x.size_snapshot, x.origin_snapshot, x.specification_snapshot,
    x.specified_image_url_snapshot, x.proposed_image_url_snapshot, x.qty, x.unit_label, x.unit_price, x.discount_type, x.discount_value, x.net_price, x.net_total, x.currency, x.source_component_data, x.cell_layout, to_jsonb(x)
  from public.quotation_items x where x.quotation_id = q.id and x.is_active;
  get diagnostics item_count = row_count;

  -- At creation the copy must add up to the stored quotation, or nothing is saved and backfill reports it later. A backfill keeps what it finds.
  if p_source_method = 'created_with_project_file' and not public.project_snapshot_total_matches(new_id, q.grand_total) then
    raise exception 'The copied items do not add up to the stored quotation total';
  end if;

  insert into public.audit_activity_log(entity_type,entity_id,action,title,description,metadata,created_by)
    values('quotation', q.id, 'project_snapshot_created', 'Project copy saved', (file->>'orderNo') || ' copied from ' || q.quotation_no,
      jsonb_build_object('snapshot_id', new_id, 'order_no', file->>'orderNo', 'source_method', p_source_method, 'item_count', item_count), auth.uid());
  return jsonb_build_object('id', new_id, 'created', true);
end $$;
revoke all on function public.project_snapshot_copy(uuid, text) from public, anon, authenticated;

-- Called right after the Project File is written. The same roles as requireRecordsManager, the check on the Create Project File action.
-- Idempotent: a second call returns the existing id.
create function public.create_project_snapshot(p_quotation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.current_user_is_active()
    or public.current_user_role()::text not in ('system_owner','admin_manager','sales_designer','sales_coordinator','designer') then
    raise insufficient_privilege;
  end if;
  return public.project_snapshot_copy(p_quotation_id, 'created_with_project_file');
end $$;
revoke all on function public.create_project_snapshot(uuid) from public, anon;
grant execute on function public.create_project_snapshot(uuid) to authenticated;

-- One-time copy for existing Projects. System Owner only. At most 50 new snapshots per call: run it until remaining is 0. Safe to run twice.
-- It fixes nothing: differences lists every backfilled Project whose copied items do not reach its frozen contract total. A row that fails is
-- listed and does not stop or use up the batch. Skipped and listed, never copied: a Project File that belongs to another quotation, and an old
-- confirmed order with no Project File.
create function public.backfill_project_snapshots() returns jsonb language plpgsql security definer set search_path='' as $$
declare
  batch_limit constant integer := 50;
  candidate record;
  result jsonb;
  created_count integer := 0;
  failed jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.current_user_is_active() or public.current_user_role()::text <> 'system_owner' then raise insufficient_privilege; end if;
  for candidate in
    select q.id, f.file->>'orderNo' as order_no from public.quotations q
    cross join lateral (select public.project_snapshot_valid_file(q.layout_settings) as file) f
    where f.file is not null and f.file->>'quotationId' = q.id::text
      and not exists (select 1 from public.project_snapshots s where s.quotation_id = q.id)
    order by q.created_at, q.id
  loop
    exit when created_count >= batch_limit;
    begin
      result := public.project_snapshot_copy(candidate.id, 'backfilled_from_live_quotation');
      if (result->>'created')::boolean then created_count := created_count + 1; end if;
    exception when others then
      failed := failed || jsonb_build_object('quotation_id', candidate.id, 'order_no', candidate.order_no, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object(
    'created', created_count,
    'failed', failed,
    'total_snapshots', (select count(*) from public.project_snapshots),
    'remaining', (select count(*) from public.quotations q
      where public.project_snapshot_valid_file(q.layout_settings)->>'quotationId' = q.id::text
        and not exists (select 1 from public.project_snapshots s where s.quotation_id = q.id)),
    'differences', coalesce((select jsonb_agg(jsonb_build_object('quotation_id', s.quotation_id, 'order_no', s.order_no, 'contract_total', s.contract_total,
        'items_total_rounded', g.rounded, 'items_total_exact', g.exact) order by s.order_no)
      from public.project_snapshots s cross join lateral public.project_snapshot_item_grands(s.id) g
      where s.source_method = 'backfilled_from_live_quotation' and not public.project_snapshot_total_matches(s.id, s.contract_total)), '[]'::jsonb),
    'skipped_other_quotations_project_file', coalesce((select jsonb_agg(jsonb_build_object('quotation_id', q.id, 'quotation_no', q.quotation_no, 'order_no', f.file->>'orderNo') order by q.quotation_no)
      from public.quotations q cross join lateral (select public.project_snapshot_valid_file(q.layout_settings) as file) f
      where f.file->>'quotationId' <> q.id::text), '[]'::jsonb),
    'skipped_confirmed_order_only', coalesce((select jsonb_agg(jsonb_build_object('quotation_id', q.id, 'quotation_no', q.quotation_no, 'order_no', q.layout_settings #>> '{clientApprovalDraft,confirmedOrder,orderNo}') order by q.quotation_no)
      from public.quotations q
      where public.project_snapshot_valid_file(q.layout_settings) is null and jsonb_typeof(q.layout_settings #> '{clientApprovalDraft,confirmedOrder}') = 'object'), '[]'::jsonb));
end $$;
revoke all on function public.backfill_project_snapshots() from public, anon;
grant execute on function public.backfill_project_snapshots() to authenticated;

-- For B2. Security invoker on purpose: the table policies apply, so a quotation the user cannot read shows no snapshot.
create function public.project_snapshot_state(p_quotation_ids uuid[]) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null or not public.current_user_is_active() then raise insufficient_privilege; end if;
  if p_quotation_ids is null or cardinality(p_quotation_ids) not between 1 and 50 then raise exception 'Choose between 1 and 50 quotations'; end if;
  return (select jsonb_agg(jsonb_build_object('quotation_id', x.id, 'has_snapshot', s.id is not null, 'snapshot_id', s.id) order by x.id)
    from (select distinct unnest(p_quotation_ids) as id) x
    left join public.project_snapshots s on s.quotation_id = x.id);
end $$;
revoke all on function public.project_snapshot_state(uuid[]) from public, anon;
grant execute on function public.project_snapshot_state(uuid[]) to authenticated;


do $test$
declare
  bad text;
begin
  if not (select bool_and(relrowsecurity) from pg_class where oid in ('public.project_snapshots'::regclass, 'public.project_snapshot_sections'::regclass, 'public.project_snapshot_items'::regclass)) then raise exception 'FAILED: row level security is off'; end if;
  if has_table_privilege('authenticated', 'public.project_snapshots', 'insert,update,delete') or has_table_privilege('authenticated', 'public.project_snapshot_items', 'insert,update,delete') or has_table_privilege('authenticated', 'public.project_snapshot_sections', 'insert,update,delete') then raise exception 'FAILED: signed-in users can write'; end if;
  if has_table_privilege('anon', 'public.project_snapshots', 'select') then raise exception 'FAILED: anon can read'; end if;
  if has_function_privilege('authenticated', 'public.project_snapshot_copy(uuid, text)', 'execute') then raise exception 'FAILED: the copy function is open'; end if;
  if not has_function_privilege('authenticated', 'public.create_project_snapshot(uuid)', 'execute') then raise exception 'FAILED: create is closed'; end if;
  -- Every column the copy reads exists on this database, or the functions above would fail on first use.
  select string_agg(c, ', ') into bad from unnest(array['item_code_snapshot','item_name_snapshot','brand_name_snapshot','category_name_snapshot','supplier_name_snapshot','supplier_notes_snapshot','model_snapshot','finish_snapshot','size_snapshot','origin_snapshot','specification_snapshot','specified_image_url_snapshot','proposed_image_url_snapshot','manual_serial','line_style','is_rate_only','is_optional','include_in_total','parent_item_id','section_id','source_template_id','source_component_data','cell_layout']) c
    where not exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = 'quotation_items' and x.column_name = c);
  if bad is not null then raise exception 'FAILED: quotation_items is missing %', bad; end if;
  select string_agg(c, ', ') into bad from unnest(array['client_number','contact_person','email','phone','address','city','country','trn']) c
    where not exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = 'clients' and x.column_name = c);
  if bad is not null then raise exception 'FAILED: clients is missing %', bad; end if;
  select string_agg(c, ', ') into bad from unnest(array['project_name','location','attention_to','attention_mobile','attention_landline','attention_email','po_box','project_address']) c
    where not exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = 'projects' and x.column_name = c);
  if bad is not null then raise exception 'FAILED: projects is missing %', bad; end if;
end $test$;

-- What the backfill will find. Read only.
select
  count(*) filter (where f.file is not null and f.file->>'quotationId' = q.id::text) as projects_to_copy,
  count(*) filter (where f.file->>'quotationId' <> q.id::text) as skipped_other_quotations_project_file,
  count(*) filter (where f.file is null and jsonb_typeof(q.layout_settings #> '{clientApprovalDraft,confirmedOrder}') = 'object') as skipped_confirmed_order_only,
  count(*) filter (where f.file is null and jsonb_typeof(q.layout_settings -> 'projectFile') is not null) as invalid_project_files
from public.quotations q cross join lateral (select public.project_snapshot_valid_file(q.layout_settings) as file) f;

-- Order numbers used by more than one real Project: the backfill would list the later one as failed.
select f.file->>'orderNo' as duplicate_order_no, count(*) as quotations
from public.quotations q cross join lateral (select public.project_snapshot_valid_file(q.layout_settings) as file) f
where f.file->>'quotationId' = q.id::text
group by 1 having count(*) > 1;

rollback;
