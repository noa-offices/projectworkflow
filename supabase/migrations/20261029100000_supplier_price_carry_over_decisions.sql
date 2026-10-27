begin;

-- Task 19c APPLY. Read-only history from other uploads of this brand.
-- Run ../tests/supplier_price_carry_over_TEST.sql before applying this migration.
create function public.list_carry_over_decisions(p_supplier_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_brand_id uuid;
begin
  if auth.uid() is null or not coalesce(inventory.can_manage(),false) then
    raise exception 'Only System Owner and Admin Manager can read review decisions.' using errcode='42501';
  end if;
  select s.brand_id into v_brand_id
  from public.supplier_source_versions s
  where s.id=p_supplier_source_id and s.status='imported';
  if not found then
    raise exception 'Supplier price list is unavailable.' using errcode='22023';
  end if;

  -- Rank before limiting so one code/field always has its latest open choice.
  -- Archived earlier versions are included; they remain part of this brand's history.
  return coalesce((
    with ranked as (
      select d.model_code,d.price_field,d.category,d.decision,d.custom_price,d.note,
        d.imported_price,d.supplier_price,d.currency,d.decided_at,d.decided_by,
        d.supplier_source_id,d.supplier_price_list_label,
        row_number() over (partition by d.model_code,d.price_field order by d.decided_at desc,d.id desc) as choice_rank
      from public.supplier_price_review_decisions d
      join public.supplier_source_versions previous on previous.id=d.supplier_source_id
      where previous.brand_id=v_brand_id and d.supplier_source_id<>p_supplier_source_id and d.status='open'
    ), chosen as (
      select * from ranked where choice_rank=1 order by model_code,price_field limit 5000
    )
    select jsonb_agg(jsonb_build_object(
      'model_code',c.model_code,'price_field',c.price_field,'category',c.category,
      'decision',c.decision,'custom_price',c.custom_price,'note',c.note,
      'imported_price',c.imported_price,'supplier_price',c.supplier_price,'currency',c.currency,
      'decided_at',c.decided_at,'decided_by_name',
        case when nullif(btrim(p.full_name),'') is null or position('@' in p.full_name)>0
          then 'Team member' else btrim(p.full_name) end,
      'from_source_id',c.supplier_source_id,'from_label',c.supplier_price_list_label)
      order by c.model_code,c.price_field)
    from chosen c left join public.profiles p on p.id=c.decided_by
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.list_carry_over_decisions(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_carry_over_decisions(uuid) to authenticated;
commit;
