-- Read-only helper for product delete Storage cleanup.
begin;
create function public.product_picture_paths_in_use(p_paths text[])
returns setof text
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null
     or not coalesce((select public.current_user_is_active()), false)
     or not coalesce((select public.current_user_role())::text in
       ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer'), false) then
    raise exception 'Product library access required' using errcode = '42501';
  end if;
  if p_paths is null or cardinality(p_paths) > 500 or coalesce(array_ndims(p_paths),1) <> 1
     or exists (select 1 from unnest(p_paths) p(path) where p.path is null or length(p.path) > 300
       or p.path !~ '^(product-templates|product-template-row-references|product-template-subgroup-references|product-template-group-references|product-template-references)/'
       or p.path ~ '(^|/)\.\.?(/|$)' or p.path ~ '[\\%?#[:cntrl:]]' or p.path like '%//%') then
    raise exception 'Provide at most 500 valid product picture paths, each at most 300 characters' using errcode = '22023';
  end if;
  -- No active/status filter: protect historical, archived and hidden quotation data too.
  return query select distinct p.path from unnest(p_paths) p(path) where exists (
    select 1 from (
      select coalesce(q.specified_image_url_snapshot,'') || E'\n' || coalesce(q.proposed_image_url_snapshot,'') || E'\n' || to_jsonb(q)::text body from public.quotation_items q
      union all select to_jsonb(q)::text from public.quotation_sections q
      union all select to_jsonb(q)::text from public.quotation_presentations q
      union all select to_jsonb(q)::text from public.quotation_pdfs q
      union all select to_jsonb(q)::text from public.quotations q
    ) refs where strpos(refs.body, p.path) > 0
  );
end;
$$;
revoke all on function public.product_picture_paths_in_use(text[]) from public, anon;
grant execute on function public.product_picture_paths_in_use(text[]) to authenticated;
commit;
