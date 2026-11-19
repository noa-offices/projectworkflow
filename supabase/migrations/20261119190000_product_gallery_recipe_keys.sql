-- Product Gallery fix: the saved configuration must keep the Base/Model, System/Base and workstation choices.
-- Before this fix product_gallery_clean_recipe dropped variant_row_id, variant_group_id, subgroup_id, system_row_id, system_quantity,
-- workstation_size_id, workstation_layout and additional_cluster_quantity, so such products lost their base choice and two quotes that
-- differed only by base model were counted as ONE gallery item. Only this function changes. Existing gallery items stay as they are
-- (the live database has no recipe line with those keys yet). NOT applied automatically.
create or replace function public.product_gallery_clean_recipe(p_recipe jsonb, p_template uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  s jsonb; l jsonb; sel jsonb; k text; v jsonb; skipped jsonb; res jsonb;
begin
  if p_recipe is null or p_template is null or jsonb_typeof(p_recipe) <> 'object' then return null; end if;
  if (p_recipe->>'template_id') is distinct from p_template::text then return null; end if;
  s := coalesce(p_recipe->'selections', '{}'::jsonb);
  l := coalesce(p_recipe->'linked', '{}'::jsonb);
  if jsonb_typeof(s) <> 'object' or jsonb_typeof(l) <> 'object' then return null; end if;
  if coalesce(s->'required_overrides', '{}'::jsonb) <> '{}'::jsonb then return null; end if;
  if coalesce(l->'instances', '{}'::jsonb) <> '{}'::jsonb then return null; end if;

  sel := '{}'::jsonb;
  -- text choices: category, base model / system / workstation choices (all ids or short labels, never prices)
  foreach k in array array['category_row_id', 'fabric_category', 'category_group_id',
                           'variant_row_id', 'variant_group_id', 'subgroup_id', 'system_row_id', 'workstation_size_id', 'workstation_layout'] loop
    v := s->k;
    if v is not null and jsonb_typeof(v) = 'string' then sel := sel || jsonb_build_object(k, v);
    elsif v is not null and jsonb_typeof(v) <> 'null' then return null; end if;
  end loop;
  -- configuration quantities (not line quantities)
  foreach k in array array['system_quantity', 'additional_cluster_quantity'] loop
    v := s->k;
    if v is not null and jsonb_typeof(v) = 'number' then sel := sel || jsonb_build_object(k, v);
    elsif v is not null and jsonb_typeof(v) <> 'null' then return null; end if;
  end loop;
  foreach k in array array['modular_quantities', 'pricing_accessory_quantities', 'component_accessory_quantities', 'component_option_selections', 'accessory_category_choices'] loop
    v := coalesce(s->k, '{}'::jsonb);
    if jsonb_typeof(v) <> 'object' then return null; end if;
    sel := sel || jsonb_build_object(k, v);
  end loop;
  v := coalesce(s->'skipped_accessory_group_ids', '[]'::jsonb);
  if jsonb_typeof(v) <> 'array' then return null; end if;
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into skipped from (select distinct jsonb_array_elements_text(v) as x) t;
  sel := sel || jsonb_build_object('skipped_accessory_group_ids', skipped);

  v := coalesce(l->'selections', '{}'::jsonb);
  if jsonb_typeof(v) <> 'object' then return null; end if;

  res := jsonb_build_object(
    'recipe_version', 1,
    'template_id', p_template,
    'selections', sel,
    'linked', jsonb_build_object('selections', v));

  if octet_length(res::text) > 65536 then return null; end if;
  -- no long typed text anywhere, and no forbidden (price / discount / cost ...) key
  if jsonb_path_exists(res, '$.** ? (@.type() == "string" && @ like_regex "^.{121,}")') then return null; end if;
  if public.my_collection_json_forbidden_key(res) then return null; end if;
  return res;
end $$;
