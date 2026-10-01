-- Current Local Builder only. No browser schema or draft migration.
-- Deploy before enabling publication in the application. No existing business rows replaced here.
alter table public.quotations add column if not exists workspace_version uuid not null default gen_random_uuid();

create schema if not exists local_builder_private;
revoke all on schema local_builder_private from public, anon;
grant usage on schema local_builder_private to authenticated;

create function local_builder_private.advance_quotation_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.workspace_version := gen_random_uuid();
  return new;
end;
$$;
create trigger local_builder_quotation_version before insert or update on public.quotations
for each row execute function local_builder_private.advance_quotation_version();

-- All writers to the composite content invalidate the same quotation version.
-- These trigger functions expose no callable mutation API and only advance versions.
create function local_builder_private.touch_parent_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  for target in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.quotation_id else null end,
      case when tg_op <> 'DELETE' then new.quotation_id else null end
    ]) x where x is not null order by x
  loop
    update public.quotations set workspace_version = workspace_version where id = target;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger local_builder_section_version before insert or update or delete on public.quotation_sections
for each row execute function local_builder_private.touch_parent_version();
create trigger local_builder_item_version before insert or update or delete on public.quotation_items
for each row execute function local_builder_private.touch_parent_version();
create trigger local_builder_presentation_version before insert or update or delete on public.quotation_presentations
for each row execute function local_builder_private.touch_parent_version();

create function local_builder_private.touch_related_versions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  for target in select q.id from public.quotations q
    where (tg_table_name = 'projects' and q.project_id = old.id)
       or (tg_table_name = 'clients' and q.client_id = old.id)
    order by q.id
  loop
    update public.quotations set workspace_version = workspace_version where id = target;
  end loop;
  return new;
end;
$$;
create trigger local_builder_project_version before update on public.projects
for each row execute function local_builder_private.touch_related_versions();
create trigger local_builder_client_version before update on public.clients
for each row execute function local_builder_private.touch_related_versions();

create table local_builder_private.publication_receipts (
  user_id uuid not null references auth.users(id),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  mutation_id uuid not null,
  base_version uuid not null,
  payload_hash text not null,
  result jsonb not null,
  primary key (user_id, quotation_id, mutation_id)
);
alter table local_builder_private.publication_receipts enable row level security;
revoke all on local_builder_private.publication_receipts from public, anon, authenticated;

create function local_builder_private.check_publisher()
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Unauthorized' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = actor and account_status = 'active'
    and role::text in ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer'))
  then raise exception 'Forbidden' using errcode = '42501'; end if;
  return actor;
end;
$$;

-- Only the non-exposed private schema owns receipt/audit bookkeeping.
-- Business reads/writes remain in the SECURITY INVOKER publication RPC, under RLS.
create function local_builder_private.publication_receipt(p_id uuid, p_mutation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := local_builder_private.check_publisher(); result jsonb;
begin
  select to_jsonb(r) into result from local_builder_private.publication_receipts r
    where user_id = actor and quotation_id = p_id and mutation_id = p_mutation;
  return result;
end;
$$;
create function local_builder_private.finish_publication(p_id uuid, p_mutation uuid, p_base uuid, p_hash text, p_result jsonb, p_metadata jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := local_builder_private.check_publisher();
begin
  if not exists (select 1 from public.quotations where id = p_id and workspace_version::text = p_result->>'version')
  then raise exception 'Publication version mismatch'; end if;
  insert into local_builder_private.publication_receipts values (actor, p_id, p_mutation, p_base, p_hash, p_result);
  insert into public.audit_activity_log(entity_type,entity_id,action,title,description,metadata,created_by)
    select 'quotation',id,'quotation_software_snapshot_saved','Quotation saved to software',quotation_no,p_metadata,actor
    from public.quotations where id = p_id;
end;
$$;
revoke all on all functions in schema local_builder_private from public, anon, authenticated;
grant execute on function local_builder_private.check_publisher(),
  local_builder_private.publication_receipt(uuid,uuid),
  local_builder_private.finish_publication(uuid,uuid,uuid,text,jsonb,jsonb) to authenticated;

create function local_builder_private.remap_ids(value jsonb, mapping jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb;
begin
  case jsonb_typeof(value)
  when 'string' then return coalesce(mapping->(value #>> '{}'), value);
  when 'array' then
    select coalesce(jsonb_agg(local_builder_private.remap_ids(v,mapping) order by n),'[]'::jsonb)
      into result from jsonb_array_elements(value) with ordinality a(v,n);
  when 'object' then
    select coalesce(jsonb_object_agg(coalesce(mapping->>k,k),local_builder_private.remap_ids(v,mapping)),'{}'::jsonb)
      into result from jsonb_each(value) a(k,v);
  else return value;
  end case;
  return result;
end;
$$;
revoke all on function local_builder_private.remap_ids(jsonb,jsonb) from public, anon;
grant execute on function local_builder_private.remap_ids(jsonb,jsonb) to authenticated;

create function public.publish_local_builder_workspace(p_id uuid, p_base_version uuid, p_mutation_id uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := local_builder_private.check_publisher();
  q public.quotations%rowtype;
  q_patch public.quotations%rowtype;
  project_patch public.projects%rowtype;
  receipt jsonb; payload_hash text; result jsonb;
  s jsonb; i jsonb; settings jsonb; header jsonb; layout jsonb;
  section_map jsonb := '{}'; item_map jsonb := '{}'; all_map jsonb;
  section_ids jsonb := '{}'; item_ids jsonb := '{}';
  new_sections jsonb := '[]'; new_items jsonb := '[]';
  old_sections uuid[]; old_items uuid[]; new_id text; n integer := 0; k text; affected integer;
begin
  if p_base_version is null or p_mutation_id is null or jsonb_typeof(p_payload->'sections') <> 'array'
     or jsonb_typeof(p_payload->'items') <> 'array' then
    raise exception 'Invalid publication' using errcode = '22023';
  end if;
  -- Parent lock serializes publication and every content writer's version trigger.
  select * into q from public.quotations where id = p_id for update;
  if not found then raise exception 'Quotation not found' using errcode = 'P0002'; end if;
  payload_hash := encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  receipt := local_builder_private.publication_receipt(p_id,p_mutation_id);
  if receipt is not null then
    if receipt->>'payload_hash' <> payload_hash or receipt->>'base_version' <> p_base_version::text then
      raise exception 'Mutation ID already bound to different content' using errcode = '22023';
    end if;
    return receipt->'result';
  end if;
  if q.workspace_version <> p_base_version then
    return jsonb_build_object('ok',false,'code','CONFLICT','error','The server quotation changed. Your local draft has been preserved.');
  end if;
  select array_agg(id order by sort_order,id) into old_sections from public.quotation_sections where quotation_id=p_id and is_active;
  select array_agg(id order by sort_order,id) into old_items from public.quotation_items where quotation_id=p_id and is_active;
  for s in select value from jsonb_array_elements(p_payload->'sections') loop
    n := n+1; new_id := gen_random_uuid()::text;
    if section_ids ? (s->>'id') then raise exception 'Duplicate section ID' using errcode='22023'; end if;
    section_ids := section_ids || jsonb_build_object(s->>'id',new_id);
    section_map := section_map || jsonb_build_object(s->>'id',new_id);
    if s->>'source_id' is not null then section_map := section_map || jsonb_build_object(s->>'source_id',new_id); end if;
    if old_sections[n] is not null then section_map := section_map || jsonb_build_object(old_sections[n]::text,new_id); end if;
  end loop;
  n := 0;
  for i in select value from jsonb_array_elements(p_payload->'items') loop
    n := n+1; new_id := gen_random_uuid()::text;
    if item_ids ? (i->>'id') then raise exception 'Duplicate item ID' using errcode='22023'; end if;
    item_ids := item_ids || jsonb_build_object(i->>'id',new_id);
    item_map := item_map || jsonb_build_object(i->>'id',new_id);
    if i->>'source_id' is not null then item_map := item_map || jsonb_build_object(i->>'source_id',new_id); end if;
    if old_items[n] is not null then item_map := item_map || jsonb_build_object(old_items[n]::text,new_id); end if;
  end loop;
  section_map := section_map || section_ids;
  item_map := item_map || item_ids;
  for s in select value from jsonb_array_elements(p_payload->'sections') loop
    if s->>'parent_section_id' is not null and not section_map ? (s->>'parent_section_id')
      then raise exception 'Invalid section parent' using errcode='22023'; end if;
    new_sections := new_sections || jsonb_build_array(s || jsonb_build_object(
      'id',section_map->>(s->>'id'),'quotation_id',p_id,
      'parent_section_id',section_map->>(s->>'parent_section_id'),'is_active',true));
  end loop;
  for i in select value from jsonb_array_elements(p_payload->'items') loop
    if (i->>'section_id' is not null and not section_map ? (i->>'section_id'))
       or (i->>'parent_item_id' is not null and not item_map ? (i->>'parent_item_id'))
      then raise exception 'Invalid item relationship' using errcode='22023'; end if;
    new_items := new_items || jsonb_build_array(i || jsonb_build_object(
      'id',item_map->>(i->>'id'),'quotation_id',p_id,'section_id',section_map->>(i->>'section_id'),
      'parent_item_id',item_map->>(i->>'parent_item_id'),'created_by',actor,'is_active',true));
  end loop;

  update public.quotation_items set is_active=false where quotation_id=p_id and is_active;
  get diagnostics affected = row_count;
  if affected <> coalesce(array_length(old_items,1),0) then raise insufficient_privilege using message='Item replacement denied'; end if;
  update public.quotation_sections set is_active=false where quotation_id=p_id and is_active;
  get diagnostics affected = row_count;
  if affected <> coalesce(array_length(old_sections,1),0) then raise insufficient_privilege using message='Section replacement denied'; end if;
  insert into public.quotation_sections (id,quotation_id,section_title,section_notes,section_type,parent_section_id,section_kind,title_align,title_bold,title_bg,title_size,row_height,sort_order,is_active)
    select r.id,r.quotation_id,r.section_title,r.section_notes,r.section_type,r.parent_section_id,r.section_kind,r.title_align,r.title_bold,r.title_bg,r.title_size,r.row_height,r.sort_order,r.is_active from jsonb_populate_recordset(null::public.quotation_sections,new_sections) r;
  insert into public.quotation_items (id,quotation_id,section_id,item_type,source_template_id,source_component_data,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,selected_options_snapshot,internal_components_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,allow_material_continuation_page,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,is_optional,parent_item_id,include_in_total,internal_cost,margin_type,margin_value,is_rate_only,line_style,row_height,cell_layout,is_active,notes,created_by)
    select r.id,r.quotation_id,r.section_id,r.item_type,r.source_template_id,r.source_component_data,r.manual_serial,r.item_code_snapshot,r.item_name_snapshot,r.brand_name_snapshot,r.category_name_snapshot,r.specified_image_url_snapshot,r.proposed_image_url_snapshot,r.specification_snapshot,r.finish_selections_snapshot,r.selected_options_snapshot,r.internal_components_snapshot,r.room_name_snapshot,r.model_snapshot,r.finish_snapshot,r.size_snapshot,r.origin_snapshot,r.warranty_snapshot,r.supplier_name_snapshot,r.supplier_notes_snapshot,r.allow_material_continuation_page,r.qty,r.unit_label,r.unit_price,r.discount_type,r.discount_value,r.net_price,r.net_total,r.currency,r.sort_order,r.is_optional,r.parent_item_id,r.include_in_total,r.internal_cost,r.margin_type,r.margin_value,r.is_rate_only,r.line_style,r.row_height,r.cell_layout,r.is_active,r.notes,r.created_by from jsonb_populate_recordset(null::public.quotation_items,new_items) r;

  select settings_json into settings from public.quotation_presentations where quotation_id=p_id;
  if found then
    if settings is null or jsonb_typeof(settings) <> 'object' then settings := '{}'; end if;
    all_map := section_map || item_map;
    foreach k in array array['hiddenItemIds','flowOrder','mainSectionOverrides','sectionOverrides','itemOverrides'] loop
      if settings ? k then
        if k in ('mainSectionOverrides','sectionOverrides','itemOverrides') and jsonb_typeof(settings->k)='object' then
          -- Override values are user content, not IDs. Remap their keys only.
          select coalesce(jsonb_object_agg(coalesce(all_map->>key,key),value),'{}'::jsonb)
            into s from jsonb_each(settings->k);
          settings := jsonb_set(settings,array[k],s);
        elsif k in ('hiddenItemIds','flowOrder') then
          settings := jsonb_set(settings,array[k],local_builder_private.remap_ids(settings->k,all_map));
        end if;
      end if;
    end loop;
    settings := settings || jsonb_build_object('updatedAt',clock_timestamp());
    update public.quotation_presentations set settings_json=settings where quotation_id=p_id;
    if not found then raise insufficient_privilege using message='Presentation update denied'; end if;
  end if;
  layout := coalesce(p_payload->'quotation'->'layout_settings','{}'::jsonb);
  if jsonb_typeof(layout) <> 'object' then layout := '{}'; end if;
  if jsonb_typeof(q.layout_settings->'documentSetup')='object' and q.layout_settings->'documentSetup' <> '{}'::jsonb then
    layout := layout || jsonb_build_object('documentSetup',q.layout_settings->'documentSetup');
  end if;
  select * into q_patch from jsonb_populate_record(null::public.quotations,
    (p_payload->'quotation') || jsonb_build_object('layout_settings',layout));
  update public.quotations set quotation_date=q_patch.quotation_date,title=q_patch.title,status=q_patch.status,currency=q_patch.currency,vat_percent=q_patch.vat_percent,layout_mode=q_patch.layout_mode,layout_settings=q_patch.layout_settings,overall_discount_type=q_patch.overall_discount_type,overall_discount_value=q_patch.overall_discount_value,subtotal=q_patch.subtotal,discount_total=q_patch.discount_total,vat_amount=q_patch.vat_amount,grand_total=q_patch.grand_total where id=p_id;
  if not found then raise exception 'Quotation update denied' using errcode='42501'; end if;

  if q.project_id is not null then
    header := coalesce(q.layout_settings->'documentSetup'->'header','{}'::jsonb);
    if jsonb_typeof(header) <> 'object' then header := '{}'; end if;
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into header
      from jsonb_each(header) where jsonb_typeof(value)='string';
    select * into project_patch from jsonb_populate_record(null::public.projects,p_payload->'project');
    project_patch.project_name := coalesce(nullif(btrim(header->>'reference'),''),project_patch.project_name,'Project');
    project_patch.location := coalesce(nullif(btrim(header->>'location'),''),project_patch.location);
    project_patch.attention_to := coalesce(nullif(btrim(header->>'contactName'),''),project_patch.attention_to);
    project_patch.attention_mobile := coalesce(nullif(btrim(header->>'contactPhone'),''),project_patch.attention_mobile);
    project_patch.attention_landline := coalesce(nullif(btrim(header->>'telephone'),''),project_patch.attention_landline);
    project_patch.attention_email := coalesce(nullif(btrim(header->>'contactEmail'),''),project_patch.attention_email);
    project_patch.po_box := coalesce(nullif(btrim(header->>'poBox'),''),project_patch.po_box);
    project_patch.project_address := coalesce(nullif(btrim(header->>'projectAddress'),''),project_patch.project_address);
    update public.projects set project_name=project_patch.project_name,location=project_patch.location,attention_to=project_patch.attention_to,attention_mobile=project_patch.attention_mobile,attention_landline=project_patch.attention_landline,attention_email=project_patch.attention_email,po_box=project_patch.po_box,project_address=project_patch.project_address where id=q.project_id;
    if not found then raise exception 'Project update denied' using errcode='42501'; end if;
  end if;
  select workspace_version into q.workspace_version from public.quotations where id=p_id;
  result := jsonb_build_object('ok',true,'version',q.workspace_version,'savedAt',clock_timestamp(),
    'mutationId',p_mutation_id,'message',case when q.project_id is null then
    'Quotation saved. Project/order details will be created after client approval.' else 'Saved to software' end);
  perform local_builder_private.finish_publication(p_id,p_mutation_id,p_base_version,payload_hash,result,
    jsonb_build_object('itemCount',jsonb_array_length(new_items),'sectionCount',jsonb_array_length(new_sections)));
  return result;
end;
$$;
revoke all on function public.publish_local_builder_workspace(uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.publish_local_builder_workspace(uuid,uuid,uuid,jsonb) to authenticated;
