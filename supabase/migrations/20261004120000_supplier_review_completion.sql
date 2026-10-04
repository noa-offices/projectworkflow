begin;

-- Phase 2D: explicit target exclusion decision and atomic Complete Brand Supplier review completion.
-- Forward-only, no backfill. Completion never writes Product prices, history or quotations.

alter table public.supplier_price_decisions drop constraint supplier_price_decisions_decision_check;
alter table public.supplier_price_decisions add constraint supplier_price_decisions_decision_check
  check (decision in ('reviewed','skip','reject','mapping_proposed','confirmed_unchanged','excluded_from_source'));

alter table public.supplier_price_batches drop constraint supplier_price_batches_status_check;
alter table public.supplier_price_batches add constraint supplier_price_batches_status_check
  check (status in ('matching','review','archived','completed'));
alter table public.supplier_price_batches
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references public.profiles(id);

-- Patch the deployed decision branch (same anchored approach as earlier Supplier review migrations).
do $migration$
declare
  definition text;
  old_guard constant text := $old$if p_payload->>'decision'='reviewed' and match_record->>'classification' not in ('increased','decreased','changed','unchanged','shared') then raise exception 'Resolve the match before marking reviewed'; end if;$old$;
  new_guard constant text := $new$if p_payload->>'decision'='excluded_from_source' then
        if not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
        if match_record->>'classification' is distinct from 'target_not_represented' then raise exception 'Only a target missing from this source can be excluded'; end if;
        if btrim(coalesce(p_payload->>'note',''))='' then raise exception 'A reason is required to exclude a target from this source'; end if;
      end if;
      $new$ || old_guard;
  old_resolved constant text := $old$d.decision in ('reviewed','skip','reject','confirmed_unchanged')$old$;
  new_resolved constant text := $new$d.decision in ('reviewed','skip','reject','confirmed_unchanged','excluded_from_source')$new$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1
    or (length(definition)-length(replace(definition,old_resolved,'')))/length(old_resolved)<>1 then
    raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
  end if;
  execute replace(replace(definition,old_guard,new_guard),old_resolved,new_resolved);
end $migration$;

-- Definer for the same reason as supplier_price_review_write: workflow tables have no direct write grants.
-- p_template_versions is the server's live target-universe check; it can only add rejections here.
create function public.complete_supplier_price_review(p_batch_id uuid, p_template_versions jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.supplier_price_batches; s public.supplier_source_versions; u public.brand_price_list_updates;
  m record; t jsonb; identity jsonb; brand_basis text; live_version bigint; tid uuid;
  covered uuid[] := '{}'; excluded uuid[] := '{}'; checked uuid[];
  changed_after constant text := 'Product prices changed after Supplier review. Build a fresh comparison before completing this price list.';
begin
  if auth.uid() is null or not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
  if jsonb_typeof(p_template_versions) is distinct from 'object' then raise exception 'Invalid template versions' using errcode='22023'; end if;
  select * into b from public.supplier_price_batches where id=p_batch_id for update;
  if not found then raise exception 'Supplier batch unavailable'; end if;
  if b.status='completed' then raise exception 'This Supplier review is already completed'; end if;
  if b.status<>'review' then raise exception 'Supplier batch must be in review before completing'; end if;
  if b.scope<>'complete' then raise exception 'Only a Complete coverage review can activate a Brand-wide baseline'; end if;
  select * into s from public.supplier_source_versions where id=b.source_id and brand_id=b.brand_id for share;
  if not found or s.status<>'imported' then raise exception 'Supplier source must be imported before completing'; end if;
  select stored_price_basis into brand_basis from public.brands where id=b.brand_id for share;
  if s.basis not in ('list','net') or brand_basis is null or brand_basis not in ('list','net') then raise exception 'Supplier price basis must be confirmed before completing'; end if;
  if s.basis<>brand_basis then raise exception 'Supplier price basis does not match the Brand stored price basis'; end if;

  for m in select mt.key, mt.classification, mt.data, d.decision from public.supplier_price_matches mt
    left join public.supplier_price_decisions d on d.batch_id=mt.batch_id and d.key=mt.key where mt.batch_id=b.id order by mt.key loop
    -- Source items ProjectWorkflow does not carry, and companion evidence, affect no Product target.
    if m.classification in ('unmatched','referenced_companion') then continue; end if;
    if m.decision in ('skip','reject','mapping_proposed') then raise exception 'Supplier review row % is %; resolve it before completing', m.key, m.decision; end if;
    if m.classification='target_not_represented' then
      if m.decision is distinct from 'excluded_from_source' then raise exception 'Target % is not represented in this source; exclude it explicitly or build a fresh comparison', m.key; end if;
      excluded := excluded || array(select (x->>'template_id')::uuid from jsonb_array_elements(m.data->'targets') x);
      continue;
    end if;
    if m.classification not in ('increased','decreased','changed','unchanged','shared') then raise exception 'Supplier review row % is unresolved (%)', m.key, m.classification; end if;
    if m.classification='unchanged' and m.decision is distinct from 'confirmed_unchanged' then raise exception 'Unchanged row % must be confirmed unchanged before completing', m.key; end if;
    select data into identity from public.supplier_source_identities where source_id=s.id and key=m.data->'source'->>'key';
    if not found or jsonb_typeof(identity->'price') is distinct from 'number' or identity->'issues' is distinct from '[]'::jsonb or identity->>'currency' is distinct from s.currency then
      raise exception 'Supplier source price for % is invalid', m.key; end if;
    if jsonb_array_length(m.data->'targets')<1 then raise exception 'Supplier review row % has no targets', m.key; end if;
    for t in select x from jsonb_array_elements(m.data->'targets') x loop
      if t->>'currency' is distinct from s.currency then raise exception '%', changed_after; end if;
      select pricing_version into live_version from public.product_templates where id=(t->>'template_id')::uuid and brand_id=b.brand_id and is_active;
      -- Live locator, code and currency must be intact and the live price must now equal the Supplier price.
      begin
        perform supplier_price_private.verify_target(t || jsonb_build_object('price',identity->'price','pricing_version',live_version::text), b.brand_id);
      exception when others then raise exception '%', changed_after;
      end;
      covered := covered || (t->>'template_id')::uuid;
    end loop;
  end loop;

  -- Only Templates whose every reviewed target was resolved against this source are marked checked.
  checked := array(select distinct x from unnest(covered) x where not (x = any(excluded)) order by x);
  foreach tid in array checked loop
    select pricing_version into live_version from public.product_templates where id=tid for update;
    if live_version::text is distinct from p_template_versions->>tid::text then raise exception '%', changed_after; end if;
  end loop;

  if b.brand_price_list_update_id is not null then
    select * into u from public.brand_price_list_updates where id=b.brand_price_list_update_id and brand_id=b.brand_id for update;
    if not found or u.status='archived' then raise exception 'Linked Brand price-list update is unavailable or archived'; end if;
    if u.currency is not null and u.currency<>s.currency then raise exception 'Linked Brand price-list update currency differs from the Supplier source'; end if;
    update public.brand_price_list_updates set status='active', coverage_mode='complete', currency=coalesce(currency,s.currency),
      effective_from=coalesce(effective_from,s.effective_from), received_at=coalesce(received_at,s.received_at)
      where id=u.id returning * into u;
  else
    insert into public.brand_price_list_updates(brand_id,title,currency,effective_from,received_at,status,coverage_mode,notes,created_by)
      values(b.brand_id,s.title,s.currency,s.effective_from,s.received_at,'active','complete','Supplier review batch '||b.id::text,auth.uid())
      returning * into u;
  end if;

  update public.product_templates set last_price_checked_at=now(), last_price_checked_by=auth.uid() where id=any(checked);
  update public.supplier_price_batches set status='completed', completed_at=now(), completed_by=auth.uid(), brand_price_list_update_id=u.id where id=b.id;

  return jsonb_build_object('price_list_update_id',u.id,'title',u.title,
    'baseline_date',coalesce(u.effective_from::text,u.received_at::text,u.created_at::text),
    'checked_templates',cardinality(checked),
    'excluded_templates',(select count(distinct x) from unnest(excluded) x));
end $$;
revoke all on function public.complete_supplier_price_review(uuid,jsonb) from public;
grant execute on function public.complete_supplier_price_review(uuid,jsonb) to authenticated;

commit;
