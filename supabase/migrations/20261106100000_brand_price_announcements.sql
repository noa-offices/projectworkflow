begin;

-- Announced price change notices, Part 1. A supplier says "prices change by about 3% from <date>" before the official price list exists.
-- A notice is only a record: it NEVER changes a price, a price list, a review, a Supplier source or a brand baseline. Quotation makers may
-- choose to add the percent to one quotation item; that is stored on the item, not here.
--
-- brand_price_announcements: one row per notice. One OPEN notice per Brand. Never deleted: cancel or close keeps the row with who and when.
-- "Official list received" is derived on read by the application (lib/products/price-announcements.ts), not stored and not by a trigger.
-- Access only through the SECURITY DEFINER functions below (deny-by-default RLS, no policies, no grants).

create table public.brand_price_announcements (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  -- Signed: positive is an increase, negative a decrease. Up to 3 decimals.
  percent numeric(6,3) not null check (percent <> 0 and percent > -100 and percent <= 100),
  effective_from date not null check (effective_from between date '2000-01-01' and date '2100-01-01'),
  note text not null default '' check (length(note) <= 200 and note = btrim(note)),
  approximate boolean not null default true,
  status text not null default 'open' check (status in ('open','cancelled','closed')),
  created_by uuid references public.profiles(id),
  created_by_name text,
  created_at timestamptz not null default clock_timestamp(),
  ended_by uuid references public.profiles(id),
  ended_by_name text,
  ended_at timestamptz,
  check ((status = 'open') = (ended_at is null))
);
create unique index brand_price_announcements_one_open on public.brand_price_announcements(brand_id) where status = 'open';
create index brand_price_announcements_brand on public.brand_price_announcements(brand_id, created_at desc);
alter table public.brand_price_announcements enable row level security;
revoke all on public.brand_price_announcements from public, anon, authenticated;

-- Notices are never deleted, and the only change allowed is ending an open notice.
create function public.brand_price_announcements_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Price change notices are history and cannot be deleted'; end if;
  if old.status <> 'open' or new.status = 'open'
    or new.id <> old.id or new.brand_id <> old.brand_id or new.percent <> old.percent or new.effective_from <> old.effective_from
    or new.note <> old.note or new.approximate <> old.approximate or new.created_at <> old.created_at
    or new.created_by is distinct from old.created_by or new.created_by_name is distinct from old.created_by_name then
    raise exception 'A price change notice can only be cancelled or closed';
  end if;
  return new;
end $$;
revoke all on function public.brand_price_announcements_guard() from public;
create trigger brand_price_announcements_no_change before update or delete on public.brand_price_announcements
  for each row execute function public.brand_price_announcements_guard();

-- Read: the open notices of the given Brands, and the facts needed to derive "official list received". Everyone who can see the Product
-- Library can read it (same check as the brands SELECT policy), including people who cannot read Supplier sources; only dates are returned.
create function public.brand_price_announcements_state(p_brand_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.current_user_is_active() then raise insufficient_privilege; end if;
  if p_brand_ids is null or cardinality(p_brand_ids) not between 1 and 50 then raise exception 'Choose between 1 and 50 brands'; end if;
  return jsonb_build_object(
    'notices', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'brand_id', n.brand_id, 'percent', n.percent, 'effective_from', n.effective_from, 'note', n.note,
        'approximate', n.approximate, 'status', n.status, 'created_by_name', n.created_by_name, 'created_at', n.created_at) order by n.brand_id)
      from public.brand_price_announcements n join public.brands b on b.id = n.brand_id
      where b.id = any(p_brand_ids) and b.is_active and n.status = 'open'), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('brand_id', b.id, 'price_check_mode', b.price_check_mode,
        'latest_supplier_list', (select max(coalesce(v.effective_from, (v.created_at at time zone 'Asia/Dubai')::date)) from public.supplier_source_versions v where v.brand_id = b.id and v.status = 'imported'),
        'latest_manual_release', (select max(r.effective_from) from public.brand_price_releases r where r.brand_id = b.id)) order by b.id)
      from public.brands b
      where b.id = any(p_brand_ids) and b.is_active and exists(select 1 from public.brand_price_announcements n where n.brand_id = b.id and n.status = 'open')), '[]'::jsonb));
end $$;
revoke all on function public.brand_price_announcements_state(uuid[]) from public;
grant execute on function public.brand_price_announcements_state(uuid[]) to authenticated;

-- Write: add a notice. One open notice per Brand; the unique index is the final guard against two people adding at once.
create function public.brand_price_announcement_add(p_brand_id uuid, p_percent numeric, p_effective_from date, p_note text, p_approximate boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare clean_note text := btrim(coalesce(p_note, '')); new_id uuid; actor text;
begin
  if auth.uid() is null or not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
  if p_percent is null or p_percent = 0 or p_percent <= -100 or p_percent > 100 or p_percent <> round(p_percent, 3) then
    raise exception 'Enter a percent other than 0, between -99.999 and 100, with at most 3 decimals';
  end if;
  if p_effective_from is null or p_effective_from < date '2000-01-01' or p_effective_from > (now() at time zone 'Asia/Dubai')::date + 366 then
    raise exception 'Choose the date the price change starts';
  end if;
  if length(clean_note) > 200 then raise exception 'The note is too long (200 characters at most)'; end if;
  perform 1 from public.brands b where b.id = p_brand_id and b.is_active for share;
  if not found then raise exception 'Brand unavailable'; end if;
  select nullif(btrim(p.full_name), '') into actor from public.profiles p where p.id = auth.uid();
  begin
    insert into public.brand_price_announcements(brand_id, percent, effective_from, note, approximate, created_by, created_by_name)
      values(p_brand_id, p_percent, p_effective_from, clean_note, coalesce(p_approximate, true), auth.uid(), actor) returning id into new_id;
  exception when unique_violation then
    raise exception 'This Brand already has an open notice. Cancel or close it before adding another.';
  end;
  insert into public.audit_activity_log(entity_type,entity_id,action,title,description,metadata,created_by)
    values('brand', p_brand_id, 'price_change_announced', 'Price change announced', p_percent::text || '% from ' || p_effective_from::text,
      jsonb_build_object('announcement_id', new_id, 'percent', p_percent, 'effective_from', p_effective_from, 'note', clean_note, 'approximate', coalesce(p_approximate, true)), auth.uid());
  return jsonb_build_object('id', new_id);
end $$;
revoke all on function public.brand_price_announcement_add(uuid, numeric, date, text, boolean) from public;
grant execute on function public.brand_price_announcement_add(uuid, numeric, date, text, boolean) to authenticated;

-- Shared by cancel and close: ends one open notice and keeps the row with who and when.
create function public.brand_price_announcement_end(p_id uuid, p_status text) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row public.brand_price_announcements; actor text;
begin
  if auth.uid() is null or not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
  if p_status not in ('cancelled','closed') then raise exception 'Choose cancel or close'; end if;
  select * into current_row from public.brand_price_announcements n where n.id = p_id for update;
  if current_row.id is null then raise exception 'Notice unavailable'; end if;
  if current_row.status <> 'open' then raise exception 'This notice is already ended. Reload the page.'; end if;
  select nullif(btrim(p.full_name), '') into actor from public.profiles p where p.id = auth.uid();
  update public.brand_price_announcements set status = p_status, ended_by = auth.uid(), ended_by_name = actor, ended_at = clock_timestamp() where id = p_id;
  insert into public.audit_activity_log(entity_type,entity_id,action,title,description,metadata,created_by)
    values('brand', current_row.brand_id, case p_status when 'cancelled' then 'price_change_notice_cancelled' else 'price_change_notice_closed' end,
      case p_status when 'cancelled' then 'Price change notice cancelled' else 'Price change notice closed' end,
      current_row.percent::text || '% from ' || current_row.effective_from::text,
      jsonb_build_object('announcement_id', p_id, 'percent', current_row.percent, 'effective_from', current_row.effective_from), auth.uid());
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;
revoke all on function public.brand_price_announcement_end(uuid, text) from public, anon, authenticated;

create function public.brand_price_announcement_cancel(p_id uuid) returns jsonb language sql security definer set search_path='' as $$
  select public.brand_price_announcement_end(p_id, 'cancelled');
$$;
revoke all on function public.brand_price_announcement_cancel(uuid) from public;
grant execute on function public.brand_price_announcement_cancel(uuid) to authenticated;

create function public.brand_price_announcement_close(p_id uuid) returns jsonb language sql security definer set search_path='' as $$
  select public.brand_price_announcement_end(p_id, 'closed');
$$;
revoke all on function public.brand_price_announcement_close(uuid) from public;
grant execute on function public.brand_price_announcement_close(uuid) to authenticated;

commit;
