begin;

-- Manual price check mode, Part 1. For a Brand with no Supplier codes (first: Colan) there is NO price list import and NO matching.
-- A manager records "New price list released" with an effective date. From that date every active product of the Brand is
-- "Price update due" until someone marks it checked for that release. Forward-only. It never changes a price, a review batch,
-- a decision, a Supplier source or a brand baseline.
--
-- 1. brands.price_check_mode: 'supplier_codes' (default, every current Brand) or 'manual'.
-- 2. brand_price_releases: insert-only history of releases.
-- 3. brand_price_release_checks: per-product sign-off for one release (insert-only; the newest row per release + product counts).
-- Access only through the SECURITY DEFINER functions below (deny-by-default RLS, no policies, no grants).

alter table public.brands add column if not exists price_check_mode text not null default 'supplier_codes';
alter table public.brands drop constraint if exists brands_price_check_mode_check;
alter table public.brands add constraint brands_price_check_mode_check check (price_check_mode in ('supplier_codes','manual'));

create table public.brand_price_releases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  effective_from date not null check (effective_from between date '2000-01-01' and date '2100-01-01'),
  note text not null default '' check (length(note) <= 200 and note = btrim(note)),
  created_by uuid references public.profiles(id),
  created_by_name text,
  created_at timestamptz not null default clock_timestamp()
);
create unique index brand_price_releases_unique on public.brand_price_releases(brand_id, effective_from, note);
create index brand_price_releases_brand on public.brand_price_releases(brand_id, effective_from desc, created_at desc);
alter table public.brand_price_releases enable row level security;
revoke all on public.brand_price_releases from public, anon, authenticated;

-- History is kept and never edited.
create function public.brand_price_releases_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Price list releases are history and cannot be changed';
end $$;
revoke all on function public.brand_price_releases_immutable() from public;
create trigger brand_price_releases_no_change before update or delete on public.brand_price_releases
  for each row execute function public.brand_price_releases_immutable();

create table public.brand_price_release_checks (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.brand_price_releases(id),
  template_id uuid not null references public.product_templates(id) on delete cascade,
  pricing_version bigint not null,
  checked_by uuid references public.profiles(id),
  checked_by_name text,
  checked_at timestamptz not null default clock_timestamp()
);
create index brand_price_release_checks_lookup on public.brand_price_release_checks(release_id, template_id, checked_at desc);
create index brand_price_release_checks_template on public.brand_price_release_checks(template_id);
alter table public.brand_price_release_checks enable row level security;
revoke all on public.brand_price_release_checks from public, anon, authenticated;

-- Read: manual Brands among the given ones, their releases, and the newest check per (release, product).
-- Readers who can review Supplier prices need it to show the status.
create function public.brand_price_manual_state(p_brand_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.current_user_can_review_brand_prices() then raise insufficient_privilege; end if;
  if p_brand_ids is null or cardinality(p_brand_ids) not between 1 and 50 then raise exception 'Choose between 1 and 50 brands'; end if;
  return jsonb_build_object(
    'brand_ids', coalesce((select jsonb_agg(b.id order by b.id) from public.brands b where b.id = any(p_brand_ids) and b.price_check_mode = 'manual'), '[]'::jsonb),
    'releases', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'brand_id', r.brand_id, 'effective_from', r.effective_from, 'note', r.note,
        'created_by_name', r.created_by_name, 'created_at', r.created_at) order by r.brand_id, r.effective_from desc, r.created_at desc)
      from public.brand_price_releases r join public.brands b on b.id = r.brand_id
      where b.id = any(p_brand_ids) and b.price_check_mode = 'manual'), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('release_id', x.release_id, 'template_id', x.template_id, 'pricing_version', x.pricing_version::text,
        'checked_at', x.checked_at, 'checked_by_name', x.checked_by_name) order by x.release_id, x.template_id)
      from (select distinct on (c.release_id, c.template_id) c.release_id, c.template_id, c.pricing_version, c.checked_at, c.checked_by_name
            from public.brand_price_release_checks c join public.brand_price_releases r on r.id = c.release_id join public.brands b on b.id = r.brand_id
            where b.id = any(p_brand_ids) and b.price_check_mode = 'manual'
            order by c.release_id, c.template_id, c.checked_at desc, c.id desc) x), '[]'::jsonb));
end $$;
revoke all on function public.brand_price_manual_state(uuid[]) from public;
grant execute on function public.brand_price_manual_state(uuid[]) to authenticated;

-- Write: switch a Brand between 'supplier_codes' and 'manual'. Existing releases and checks are kept either way.
create function public.brand_price_check_mode_set(p_brand_id uuid, p_mode text) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous text;
begin
  if auth.uid() is null or not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
  if p_mode is null or p_mode not in ('supplier_codes','manual') then raise exception 'Choose a price check mode'; end if;
  select b.price_check_mode into previous from public.brands b where b.id = p_brand_id and b.is_active for update;
  if previous is null then raise exception 'Brand unavailable'; end if;
  if previous <> p_mode then
    update public.brands set price_check_mode = p_mode where id = p_brand_id;
    insert into public.audit_activity_log(entity_type,entity_id,action,title,description,metadata,created_by)
      values('brand', p_brand_id, 'price_check_mode_changed', 'Price check mode changed', 'Price check mode: ' || previous || ' to ' || p_mode,
        jsonb_build_object('from', previous, 'to', p_mode), auth.uid());
  end if;
  return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode);
end $$;
revoke all on function public.brand_price_check_mode_set(uuid, text) from public;
grant execute on function public.brand_price_check_mode_set(uuid, text) to authenticated;

-- Write: record "New price list released" for a manual Brand.
create function public.brand_price_release_add(p_brand_id uuid, p_effective_from date, p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare clean_note text := btrim(coalesce(p_note, '')); mode text; new_id uuid; actor text;
begin
  if auth.uid() is null or not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
  if p_effective_from is null or p_effective_from < date '2000-01-01' or p_effective_from > (now() at time zone 'Asia/Dubai')::date + 366 then
    raise exception 'Choose the date the new price list starts';
  end if;
  if length(clean_note) > 200 then raise exception 'The note is too long (200 characters at most)'; end if;
  select b.price_check_mode into mode from public.brands b where b.id = p_brand_id and b.is_active for share;
  if mode is null then raise exception 'Brand unavailable'; end if;
  if mode <> 'manual' then raise exception 'This Brand does not use manual price checks'; end if;
  if exists(select 1 from public.brand_price_releases r where r.brand_id = p_brand_id and r.effective_from = p_effective_from and r.note = clean_note) then
    raise exception 'This price list release is already recorded';
  end if;
  select nullif(btrim(p.full_name), '') into actor from public.profiles p where p.id = auth.uid();
  insert into public.brand_price_releases(brand_id, effective_from, note, created_by, created_by_name)
    values(p_brand_id, p_effective_from, clean_note, auth.uid(), actor) returning id into new_id;
  insert into public.audit_activity_log(entity_type,entity_id,action,title,description,metadata,created_by)
    values('brand', p_brand_id, 'manual_price_list_released', 'New price list released', coalesce(nullif(clean_note, ''), 'Price list') || ' effective ' || p_effective_from::text,
      jsonb_build_object('release_id', new_id, 'effective_from', p_effective_from, 'note', clean_note), auth.uid());
  return jsonb_build_object('id', new_id);
end $$;
revoke all on function public.brand_price_release_add(uuid, date, text) from public;
grant execute on function public.brand_price_release_add(uuid, date, text) to authenticated;

-- Write: sign off one product for one release. Only the LATEST release whose date has passed can be checked, and only
-- against the product's current pricing version (a product edited meanwhile is refused).
create function public.brand_price_release_check_set(p_template_id uuid, p_release_id uuid, p_expected_pricing_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_version bigint; tpl_brand uuid; rel_brand uuid; rel_date date; mode text; latest_id uuid; actor text; new_id uuid; today date := (now() at time zone 'Asia/Dubai')::date;
begin
  if auth.uid() is null or not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
  if p_template_id is null or p_release_id is null or p_expected_pricing_version is null then raise exception 'Choose the product and the release'; end if;
  select tpl.pricing_version, tpl.brand_id into current_version, tpl_brand from public.product_templates tpl where tpl.id = p_template_id and tpl.is_active for update;
  if current_version is null then raise exception 'Product unavailable'; end if;
  if current_version <> p_expected_pricing_version then raise exception 'This Product Template changed. Reload before marking it checked.'; end if;
  select r.brand_id, r.effective_from into rel_brand, rel_date from public.brand_price_releases r where r.id = p_release_id;
  if rel_brand is null or rel_brand <> tpl_brand then raise exception 'This release does not belong to the product''s Brand'; end if;
  select b.price_check_mode into mode from public.brands b where b.id = tpl_brand;
  if mode <> 'manual' then raise exception 'This Brand does not use manual price checks'; end if;
  select r.id into latest_id from public.brand_price_releases r where r.brand_id = tpl_brand and r.effective_from <= today order by r.effective_from desc, r.created_at desc, r.id desc limit 1;
  if latest_id is distinct from p_release_id then raise exception 'This is not the latest released price list. Reload the page.'; end if;
  select nullif(btrim(p.full_name), '') into actor from public.profiles p where p.id = auth.uid();
  insert into public.brand_price_release_checks(release_id, template_id, pricing_version, checked_by, checked_by_name)
    values(p_release_id, p_template_id, current_version, auth.uid(), actor) returning id into new_id;
  insert into public.audit_activity_log(entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by)
    values('manual_price_check', p_template_id, 'brand', tpl_brand, 'manual_price_checked', 'Product marked as price checked',
      'Checked against the price list effective ' || rel_date::text,
      jsonb_build_object('release_id', p_release_id, 'pricing_version', current_version), auth.uid());
  return jsonb_build_object('id', new_id);
end $$;
revoke all on function public.brand_price_release_check_set(uuid, uuid, bigint) from public;
grant execute on function public.brand_price_release_check_set(uuid, uuid, bigint) to authenticated;

commit;
