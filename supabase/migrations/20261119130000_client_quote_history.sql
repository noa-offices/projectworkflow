-- Client Quote History (stage A): remembers, per client, the items that were quoted to them, so staff can re-add them in one click.
-- A history row is written ONLY by a database trigger when a quotation's status changes to anything except draft, cancelled or archived
-- (staff often skip statuses, so any real move out of draft counts; a cancelled or archived quote never adds prices).
-- Users get SELECT only (sales roles); deleting a row and merging clients go through SECURITY DEFINER functions.
-- No prices of other things are copied: only the final unit price (net_price) per line. internal_cost / margins are never copied.
-- NOT applied automatically.

-- A. Who may use the history (same sales roles that use the quote builder; viewer, procurement and warehouse are NOT included).
create or replace function public.client_history_can_use()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_is_active()
    and public.current_user_role() in ('system_owner','admin_manager','sales_designer','sales_coordinator','designer'), false);
$$;

-- B. Table.
create table if not exists public.client_quote_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  identity_key text not null check (char_length(identity_key) between 3 and 200),
  kind text not null check (kind in ('configured', 'library', 'custom')),
  template_id uuid,
  item_name text not null check (char_length(btrim(item_name)) between 1 and 300),
  brand text check (brand is null or char_length(brand) <= 120),
  item_code text check (item_code is null or char_length(item_code) <= 80),
  spec_short text check (spec_short is null or char_length(spec_short) <= 300),
  unit_label text check (unit_label is null or char_length(unit_label) <= 30),
  qty numeric,
  currency text not null check (char_length(currency) between 1 and 8),
  last_unit_price numeric(14,2) not null check (last_unit_price >= 0),
  last_prices jsonb not null default '[]'::jsonb check (jsonb_typeof(last_prices) = 'array' and jsonb_array_length(last_prices) <= 5),
  line_recipe jsonb check (line_recipe is null or (jsonb_typeof(line_recipe) = 'object' and octet_length(line_recipe::text) <= 65536)),
  picture_ref text check (picture_ref is null or (char_length(picture_ref) <= 400 and picture_ref like 'quote-images:quotation-items/%')),
  last_quotation_id uuid references public.quotations(id) on delete set null,
  last_quotation_no text,
  quoted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint client_quote_history_unique unique (client_id, identity_key),
  constraint client_quote_history_recipe_only_configured check (line_recipe is null or kind = 'configured')
);
create index if not exists client_quote_history_client_quoted_idx on public.client_quote_history (client_id, quoted_at desc);
create index if not exists client_quote_history_quotation_idx on public.client_quote_history (last_quotation_id);

alter table public.client_quote_history enable row level security;
drop policy if exists client_quote_history_select on public.client_quote_history;
create policy client_quote_history_select on public.client_quote_history for select to authenticated
  using ((select public.client_history_can_use()));
revoke all on public.client_quote_history from public, anon, authenticated;
grant select on public.client_quote_history to authenticated;   -- no insert/update/delete for users

-- C. Identity of "the same item" (no prices involved).
create or replace function public.client_quote_history_identity(p_kind text, p_template uuid, p_recipe jsonb, p_options jsonb,
  p_brand text, p_name text, p_code text) returns text language sql immutable set search_path = '' as $$
  select case p_kind
    when 'configured' then 'c:' || p_template::text || ':' || encode(sha256(convert_to(
      coalesce(((p_recipe->'recipe') - 'display' - 'selected_image')::text, '') || '|' || coalesce((p_recipe->'spec_overrides')::text, ''), 'UTF8')), 'hex')
    when 'library' then 'l:' || p_template::text || ':' || encode(sha256(convert_to(coalesce(p_options, '[]'::jsonb)::text, 'UTF8')), 'hex')
    else case
      when nullif(lower(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g')), '') is not null
        then 'u:code:' || lower(regexp_replace(p_code, '[^a-zA-Z0-9]', '', 'g'))
      else 'u:' || lower(regexp_replace(coalesce(p_brand, ''), '[^a-zA-Z0-9]', '', 'g')) || '|' || lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]', '', 'g'))
    end
  end;
$$;

-- D. Record one quotation into the history. Internal: only the trigger calls it. Returns how many items were skipped because the client's history is full (300).
create or replace function public.client_quote_history_record(p_quotation_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare q record; r record; v_skipped integer := 0; v_count integer; v_entry jsonb; v_rows integer;
begin
  select id, client_id, quotation_no into q from public.quotations where id = p_quotation_id and is_active;
  if not found or q.client_id is null then return 0; end if;

  for r in
    with base as (
      select i.sort_order, i.net_price, i.qty, i.currency, i.unit_label, i.source_template_id,
             btrim(i.item_name_snapshot) as item_name, nullif(btrim(i.brand_name_snapshot), '') as brand,
             nullif(btrim(i.item_code_snapshot), '') as item_code, nullif(btrim(left(i.specification_snapshot, 300)), '') as spec_short,
             i.selected_options_snapshot,
             case when jsonb_typeof(i.source_component_data->'configuration_recipe') = 'object'
                   and octet_length((i.source_component_data->'configuration_recipe')::text) <= 65536
                   and not public.my_collection_json_forbidden_key(i.source_component_data->'configuration_recipe')
                  then i.source_component_data->'configuration_recipe' end as recipe,
             case when i.item_type = 'custom' or i.source_template_id is null then 'custom' else 'product' end as base_kind,
             case when i.proposed_image_url_snapshot like 'quote-images:quotation-items/%' and char_length(i.proposed_image_url_snapshot) <= 400
                  then i.proposed_image_url_snapshot end as picture
        from public.quotation_items i
       where i.quotation_id = q.id and i.is_active and i.item_type in ('product', 'custom')
         and coalesce(i.line_style, '') not in ('heading', 'note', 'no_quote')
         and not i.is_rate_only and i.include_in_total and i.parent_item_id is null
         and i.net_price > 0 and char_length(btrim(coalesce(i.item_name_snapshot, ''))) > 0
    ), typed as (
      select b.*, case when b.base_kind = 'custom' then 'custom' when b.recipe is not null then 'configured' else 'library' end as kind from base b
    ), keyed as (
      select t.*, public.client_quote_history_identity(t.kind, t.source_template_id, t.recipe, t.selected_options_snapshot, t.brand, t.item_name, t.item_code) as identity_key from typed t
    )
    select distinct on (identity_key) * from keyed order by identity_key, sort_order desc
  loop
    v_entry := jsonb_build_object('price', r.net_price, 'currency', r.currency, 'qty', r.qty, 'at', now(), 'quotation_id', q.id, 'quotation_no', q.quotation_no);

    update public.client_quote_history h set
        kind = r.kind, template_id = r.source_template_id, item_name = left(r.item_name, 300), brand = left(r.brand, 120),
        item_code = left(r.item_code, 80), spec_short = r.spec_short, unit_label = left(r.unit_label, 30), qty = r.qty,
        currency = r.currency, last_unit_price = round(r.net_price, 2),
        last_prices = (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from (
            select e, ord from jsonb_array_elements(v_entry || case when h.last_prices->0->>'quotation_id' = q.id::text then h.last_prices - 0 else h.last_prices end) with ordinality t(e, ord)
            order by ord limit 5) s),
        line_recipe = case when r.kind = 'configured' then r.recipe end,
        picture_ref = case when r.kind = 'custom' then r.picture end,
        last_quotation_id = q.id, last_quotation_no = q.quotation_no, quoted_at = now()
      where h.client_id = q.client_id and h.identity_key = r.identity_key;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
      select count(*) into v_count from public.client_quote_history where client_id = q.client_id;
      if v_count >= 300 then
        v_skipped := v_skipped + 1;
      else
        insert into public.client_quote_history (client_id, identity_key, kind, template_id, item_name, brand, item_code, spec_short, unit_label, qty,
            currency, last_unit_price, last_prices, line_recipe, picture_ref, last_quotation_id, last_quotation_no)
        values (q.client_id, r.identity_key, r.kind, r.source_template_id, left(r.item_name, 300), left(r.brand, 120), left(r.item_code, 80), r.spec_short,
            left(r.unit_label, 30), r.qty, r.currency, round(r.net_price, 2), jsonb_build_array(v_entry),
            case when r.kind = 'configured' then r.recipe end, case when r.kind = 'custom' then r.picture end, q.id, q.quotation_no)
        on conflict (client_id, identity_key) do nothing;
      end if;
    end if;
  end loop;
  return v_skipped;
end $$;

-- E. Trigger: runs when a quotation's status changes to anything except draft / cancelled / archived. A problem here never blocks the status change.
create or replace function public.client_quote_history_on_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public.client_quote_history_record(new.id);
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists quotations_record_client_history on public.quotations;
create trigger quotations_record_client_history after update of status on public.quotations
  for each row when (new.status not in ('draft', 'cancelled', 'archived') and old.status is distinct from new.status)
  execute function public.client_quote_history_on_status();

-- F. Delete one history row by hand (sales roles).
create or replace function public.client_quote_history_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.client_history_can_use() then raise exception 'Not allowed.'; end if;
  delete from public.client_quote_history where id = p_id;
  return found;
end $$;

-- G. Client merge: move the duplicate client's history to the primary client BEFORE the duplicate client is deleted (it would cascade away).
create or replace function public.client_quote_history_merge_clients(p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.current_user_can_manage_records() then raise exception 'Not allowed.'; end if;
  if p_from is null or p_to is null or p_from = p_to then return; end if;
  delete from public.client_quote_history f using public.client_quote_history t
   where f.client_id = p_from and t.client_id = p_to and t.identity_key = f.identity_key and t.quoted_at >= f.quoted_at;
  delete from public.client_quote_history t
   where t.client_id = p_to and exists (select 1 from public.client_quote_history f where f.client_id = p_from and f.identity_key = t.identity_key);
  update public.client_quote_history set client_id = p_to where client_id = p_from;
end $$;

-- H. Execute rights.
revoke all on function public.client_history_can_use(), public.client_quote_history_identity(text,uuid,jsonb,jsonb,text,text,text),
  public.client_quote_history_record(uuid), public.client_quote_history_on_status(), public.client_quote_history_delete(uuid),
  public.client_quote_history_merge_clients(uuid,uuid) from public, anon, authenticated;
grant execute on function public.client_quote_history_delete(uuid), public.client_quote_history_merge_clients(uuid,uuid) to authenticated;
grant execute on function public.client_history_can_use() to authenticated;   -- needed by the RLS policy
