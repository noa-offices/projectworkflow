begin;

-- Task 19b APPLY. Run ../tests/supplier_price_review_decisions_TEST.sql first.
-- Decisions only: no product-price, draft, price-update or notification writes.
create table public.supplier_price_review_decisions (
  id uuid primary key default gen_random_uuid(),
  supplier_source_id uuid not null references public.supplier_source_versions(id) on delete cascade,
  supplier_price_list_label text not null check (length(btrim(supplier_price_list_label)) between 1 and 500),
  model_code text not null check (length(btrim(model_code)) between 1 and 200 and model_code=btrim(model_code)),
  price_field text not null check (price_field in ('unit_price','default_price','additional_price')),
  category text check (length(category)<=500),
  imported_price numeric check (imported_price>=0 and imported_price<=1000000000000000),
  supplier_price numeric check (supplier_price>=0 and supplier_price<=1000000000000000),
  currency text check (currency in ('AED','EUR','USD')),
  decision text not null check (decision in ('use_supplier','keep_imported','set_custom','check_later','ignore')),
  custom_price numeric check (custom_price>=0 and custom_price<=1000000000000000),
  note text check (length(note)<=500),
  status text not null default 'open' check (status in ('open','applied','cancelled')),
  decided_by uuid default auth.uid() references public.profiles(id) on delete set null,
  decided_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (supplier_source_id, model_code, price_field),
  check ((decision='set_custom' and custom_price is not null) or (decision<>'set_custom' and custom_price is null)),
  check (decision<>'use_supplier' or supplier_price is not null)
);
alter table public.supplier_price_review_decisions enable row level security;
-- Reuse the exact manager-only gate protecting inventory.product_costs.
create policy manager_read on public.supplier_price_review_decisions for select to authenticated
  using (auth.uid() is not null and inventory.can_manage());
-- No direct access, even for managers. RPCs below are the only application interface.
revoke all on public.supplier_price_review_decisions from public, anon, authenticated, service_role;

create function public.supplier_price_review_decisions_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at=clock_timestamp(); new.updated_by=auth.uid(); return new; end;
$$;
revoke all on function public.supplier_price_review_decisions_updated_at() from public, anon, authenticated, service_role;
create trigger supplier_price_review_decisions_updated_at before update on public.supplier_price_review_decisions
for each row execute function public.supplier_price_review_decisions_updated_at();

create function public.list_supplier_price_decisions(p_supplier_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce(inventory.can_manage(),false) then
    raise exception 'Only System Owner and Admin Manager can read review decisions.' using errcode='42501';
  end if;
  if p_supplier_source_id is null then raise exception 'Choose a supplier source.' using errcode='22023'; end if;
  -- Definer lookup intentionally bypasses profiles RLS; only full_name leaves this function.
  return coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('decided_by_name',
    case when nullif(btrim(p.full_name),'') is null or position('@' in p.full_name)>0 then 'Team member' else btrim(p.full_name) end)
    order by d.model_code,d.price_field)
    from public.supplier_price_review_decisions d left join public.profiles p on p.id=d.decided_by
    where d.supplier_source_id=p_supplier_source_id),'[]'::jsonb);
end;
$$;

create function public.save_supplier_price_decisions(p_decisions jsonb)
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
      ('supplier_source_id','supplier_price_list_label','model_code','price_field','category','imported_price','supplier_price','currency','decision','custom_price','note','status')) then
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
    row_key=jsonb_build_array(source_id,item->>'model_code',item->>'price_field')::text;
    if row_key=any(seen) then raise exception 'Send each source, model code and price field only once.' using errcode='22023'; end if;
    seen=array_append(seen,row_key);
    insert into public.supplier_price_review_decisions as d
      (supplier_source_id,supplier_price_list_label,model_code,price_field,category,imported_price,supplier_price,currency,decision,custom_price,note,status,decided_by,decided_at,updated_by)
    values (source_id,item->>'supplier_price_list_label',item->>'model_code',item->>'price_field',item->>'category',(item->>'imported_price')::numeric,
      (item->>'supplier_price')::numeric,item->>'currency',item->>'decision',(item->>'custom_price')::numeric,item->>'note',coalesce(item->>'status','open'),auth.uid(),clock_timestamp(),auth.uid())
    on conflict (supplier_source_id,model_code,price_field) do update set
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
revoke all on function public.list_supplier_price_decisions(uuid) from public, anon, authenticated, service_role;
revoke all on function public.save_supplier_price_decisions(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.list_supplier_price_decisions(uuid) to authenticated;
grant execute on function public.save_supplier_price_decisions(jsonb) to authenticated;
commit;
