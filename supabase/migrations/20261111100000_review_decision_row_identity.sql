begin;

-- Review decisions per product row. Several product rows can share one code and price field (for example one option code priced per chair model),
-- so the decision key gets the row identity (the Smart Setup draft row locator). Existing decisions keep row_ref = '' and keep working unchanged.
-- Decisions only: no product-price, draft, price-update or notification writes.
alter table public.supplier_price_review_decisions
  add column row_ref text not null default '' check (length(row_ref)<=300);

-- Replace the old unique key (supplier_source_id, model_code, price_field). Its name is looked up, never assumed (Postgres may have truncated it).
do $migration$
declare old_name text; n int;
begin
  select count(*), min(c.conname) into n, old_name
  from pg_constraint c
  where c.conrelid='public.supplier_price_review_decisions'::regclass and c.contype='u'
    and (select array_agg(a.attname::text order by a.attname::text) from pg_attribute a where a.attrelid=c.conrelid and a.attnum=any(c.conkey))
      = array['model_code','price_field','supplier_source_id'];
  if n<>1 then raise exception 'Expected exactly one unique key on (supplier_source_id, model_code, price_field), found %',n; end if;
  execute format('alter table public.supplier_price_review_decisions drop constraint %I',old_name);
end $migration$;
alter table public.supplier_price_review_decisions
  add constraint supplier_price_review_decisions_row_key unique (supplier_source_id, model_code, price_field, row_ref);

-- Same signature as before (jsonb -> jsonb); grants are kept by create or replace and restated below.
create or replace function public.save_supplier_price_decisions(p_decisions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb; field text; source_id uuid; saved_id uuid; saved_ids uuid[] := '{}';
  number_value numeric; seen text[] := '{}'; row_key text;
begin
  -- Check the live profile, never user-editable claims. Null/no profile fails closed.
  if auth.uid() is null or not coalesce(inventory.can_manage(),false) then
    raise exception 'Only System Owner and Admin Manager can save review decisions.' using errcode='42501';
  end if;
  if p_decisions is null or jsonb_typeof(p_decisions)<>'array' then
    raise exception 'Send an array of decisions.' using errcode='22023';
  end if;
  if jsonb_array_length(p_decisions) not between 1 and 200 then
    raise exception 'Save between 1 and 200 decisions at a time.' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_decisions) loop
    if jsonb_typeof(item)<>'object' then raise exception 'Each decision must be an object.' using errcode='22023'; end if;
    if exists(select 1 from jsonb_object_keys(item) k where k not in
      ('supplier_source_id','supplier_price_list_label','model_code','price_field','category','row_ref','imported_price','supplier_price','currency','decision','custom_price','note','status')) then
      raise exception 'Unsupported decision field.' using errcode='22023';
    end if;
    foreach field in array array['supplier_source_id','supplier_price_list_label','model_code','price_field','decision'] loop
      if jsonb_typeof(item->field) is distinct from 'string' or nullif(btrim(item->>field),'') is null or item->>field<>btrim(item->>field) then
        raise exception 'Invalid required text field: %',field using errcode='22023';
      end if;
    end loop;
    if (item->>'supplier_source_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or length(item->>'supplier_price_list_label')>500 or length(item->>'model_code')>200
      or item->>'price_field' not in ('unit_price','default_price','additional_price')
      or item->>'decision' not in ('use_supplier','keep_imported','set_custom','check_later','ignore') then
      raise exception 'Invalid source, code, price field or decision.' using errcode='22023';
    end if;
    -- Row identity is optional; empty means the decision applies the old way (one decision per code and price field).
    if item ? 'row_ref' and (jsonb_typeof(item->'row_ref') is distinct from 'string' or length(item->>'row_ref')>300) then
      raise exception 'Invalid product row.' using errcode='22023';
    end if;
    foreach field in array array['category','note','currency'] loop
      if item ? field and jsonb_typeof(item->field) not in ('string','null') then raise exception 'Invalid text field: %',field using errcode='22023'; end if;
    end loop;
    if length(item->>'category')>500 or length(item->>'note')>500 or (item->>'currency' is not null and item->>'currency' not in ('AED','EUR','USD')) then
      raise exception 'Invalid currency or text longer than 500 characters.' using errcode='22023';
    end if;
    foreach field in array array['imported_price','supplier_price','custom_price'] loop
      if item ? field and jsonb_typeof(item->field)<>'null' then
        if jsonb_typeof(item->field)<>'number' then raise exception 'Invalid numeric field: %',field using errcode='22023'; end if;
        number_value=(item->>field)::numeric;
        if number_value<0 or number_value>1000000000000000 then raise exception 'Price out of range: %',field using errcode='22023'; end if;
      end if;
    end loop;
    if (item->>'decision'='set_custom' and item->>'custom_price' is null)
      or (item->>'decision'<>'set_custom' and item->>'custom_price' is not null)
      or (item->>'decision'='use_supplier' and item->>'supplier_price' is null) then
      raise exception 'This decision needs a valid price.' using errcode='22023';
    end if;
    -- Applied is reserved for the future price-application workflow, never accepted here.
    if item ? 'status' and (jsonb_typeof(item->'status') is distinct from 'string' or item->>'status' not in ('open','cancelled')) then
      raise exception 'Status must be open or cancelled.' using errcode='22023';
    end if;
    source_id=(item->>'supplier_source_id')::uuid;
    if not exists(select 1 from public.supplier_source_versions s where s.id=source_id and s.status='imported') then
      raise exception 'Supplier price list is unavailable.' using errcode='22023';
    end if;
    row_key=jsonb_build_array(source_id,item->>'model_code',item->>'price_field',coalesce(item->>'row_ref',''))::text;
    if row_key=any(seen) then raise exception 'Send each source, model code, price field and product row only once.' using errcode='22023'; end if;
    seen=array_append(seen,row_key);
    insert into public.supplier_price_review_decisions as d
      (supplier_source_id,supplier_price_list_label,model_code,price_field,category,row_ref,imported_price,supplier_price,currency,decision,custom_price,note,status,decided_by,decided_at,updated_by)
    values (source_id,item->>'supplier_price_list_label',item->>'model_code',item->>'price_field',item->>'category',coalesce(item->>'row_ref',''),(item->>'imported_price')::numeric,
      (item->>'supplier_price')::numeric,item->>'currency',item->>'decision',(item->>'custom_price')::numeric,item->>'note',coalesce(item->>'status','open'),auth.uid(),clock_timestamp(),auth.uid())
    on conflict (supplier_source_id,model_code,price_field,row_ref) do update set
      supplier_price_list_label=excluded.supplier_price_list_label,category=excluded.category,imported_price=excluded.imported_price,supplier_price=excluded.supplier_price,
      currency=excluded.currency,decision=excluded.decision,custom_price=excluded.custom_price,note=excluded.note,status=excluded.status,
      decided_by=excluded.decided_by,decided_at=excluded.decided_at,updated_by=auth.uid()
    returning d.id into saved_id;
    saved_ids=array_append(saved_ids,saved_id);
  end loop;
  return (select jsonb_agg(to_jsonb(d) || jsonb_build_object('decided_by_name',
    case when nullif(btrim(p.full_name),'') is null or position('@' in p.full_name)>0 then 'Team member' else btrim(p.full_name) end)
    order by d.model_code,d.price_field)
    from public.supplier_price_review_decisions d left join public.profiles p on p.id=d.decided_by where d.id=any(saved_ids));
end;
$$;
revoke all on function public.save_supplier_price_decisions(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_supplier_price_decisions(jsonb) to authenticated;
commit;
