begin;

-- Optional Supplier family / sub-family columns on an import profile (profile.series_column, profile.subfamily_column).
-- The import (normalizeSupplierRows) writes a family-tagged dimension into each cell, so the existing finalize grouping by
-- (code, price_field, dimension) already keeps identities of different families apart. This migration only adds the three pieces the
-- database itself owns, all additive:
--   1. the two columns are kept in supplier_source_rows.raw_extras (retained values);
--   2. a finalised identity's raw_dimension stays the PLAIN category/tier (the family tag is removed from it);
--   3. evidence rows also show the family and sub-family labels.
-- Identity keys stay ["code","price_field","dimension"]. A profile without these settings produces exactly the same rows, keys and
-- issues as before: no cell dimension starts with the family tag, so every changed expression returns its input unchanged.

-- Plain category/tier of a dimension. Anything that is not a family-tagged dimension is returned as it is.
create function public.supplier_plain_dimension(p_dimension text) returns text language plpgsql immutable set search_path='' as $$
declare parsed jsonb;
begin
  if p_dimension is null or left(p_dimension, 1) <> '[' then return p_dimension; end if;
  parsed := p_dimension::jsonb;
  if jsonb_typeof(parsed) = 'array' and jsonb_typeof(parsed -> 0) = 'string' and parsed ->> 1 = 'series' then return parsed ->> 0; end if;
  return p_dimension;
exception when others then return p_dimension;
end $$;
revoke all on function public.supplier_plain_dimension(text) from public;
grant execute on function public.supplier_plain_dimension(text) to authenticated;

-- Same rule as before plus the two optional columns.
create or replace function public.supplier_retained_values(p_profile jsonb, p_values jsonb) returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(coalesce(p_values, '{}'::jsonb)) e
  where e.key in (p_profile->>'full_code_column', p_profile->>'article_code_column', p_profile->>'category_column', p_profile->>'description_column', p_profile->>'companion_note_column', p_profile->>'series_column', p_profile->>'subfamily_column')
    or e.key in (select pc->>'column' from jsonb_array_elements(coalesce(p_profile->'price_columns', '[]'::jsonb)) pc)
    or e.key in (select jsonb_array_elements_text(case when jsonb_typeof(p_profile->'retained_columns')='array' then p_profile->'retained_columns' else '[]'::jsonb end));
$$;

-- Same evidence as before plus family_label and subfamily_label (null labels are stripped, so unchanged for profiles without them).
create or replace function public.supplier_identity_evidence(p_source uuid, p_profile jsonb, p_code text, p_price_field text, p_dimension text, p_tiered boolean, p_tier_price numeric)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(e.item order by e.row_number, e.unit_key), '[]'::jsonb) from (
    select r.row_number, r.unit_key, jsonb_strip_nulls(jsonb_build_object(
      'row_number', r.row_number, 'sheet', r.sheet, 'full_supplier_code', c.raw_code, 'article_code', nullif(c.raw_article, ''),
      'description', case when p_profile->>'description_column' is not null then nullif(r.raw_extras->>(p_profile->>'description_column'), '') end,
      'finish_code', nullif(c.finish, ''),
      'category_label', case when p_profile->>'category_column' is not null then nullif(btrim(r.raw_extras->>(p_profile->>'category_column')), '') end,
      'family_label', case when p_profile->>'series_column' is not null then nullif(btrim(r.raw_extras->>(p_profile->>'series_column')), '') end,
      'subfamily_label', case when p_profile->>'subfamily_column' is not null then nullif(btrim(r.raw_extras->>(p_profile->>'subfamily_column')), '') end,
      'dimension_label', nullif(c.dimension, ''), 'raw_price', c.raw_price)) item
    from public.supplier_source_cells c join public.supplier_source_rows r on r.source_id=c.source_id and r.unit_key=c.row_key
    where c.source_id=p_source and c.code=p_code and c.price_field=p_price_field and c.dimension=p_dimension and (not p_tiered or c.price is not distinct from p_tier_price)
    order by r.row_number, r.unit_key limit 5) e;
$$;

-- Patch both finalize bodies (the single-statement operation and the staged step) once each, with an anchor-count guard.
do $migration$
declare
  definition text;
  old_raw constant text := $old$'raw_dimension',dimension,'finishes'$old$;
  new_raw constant text := $new$'raw_dimension',public.supplier_plain_dimension(dimension),'finishes'$new$;
  signature text;
begin
  foreach signature in array array['public.supplier_price_review_write(text,jsonb)', 'public.supplier_finalize_source_step(uuid,integer)'] loop
    select pg_get_functiondef(to_regprocedure(signature)) into definition;
    if definition is null then raise exception 'Function % not found; review before migrating', signature; end if;
    if position('supplier_plain_dimension' in definition)>0
      or (length(definition)-length(replace(definition,old_raw,'')))/length(old_raw)<>1 then
      raise exception 'Deployed % differs from the expected body; review before migrating', signature;
    end if;
    execute replace(definition,old_raw,new_raw);
  end loop;
end $migration$;

commit;
