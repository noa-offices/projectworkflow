-- Product Library default rates: the company's default exchange rate to AED for each source currency, used when adding a product to a quotation.
-- NOT applied automatically.
--  * Separate from the Product Gallery rates, which this migration does not touch.
--  * A system owner, an admin manager or a procurement manager can set or remove a default rate.
--  * The roles that can see prices in the Product Library can read the rates.
--  * These are defaults only; no saved quotation is ever changed. The table starts empty.
create or replace function public.product_library_rates_can_view()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_is_active()
    and public.current_user_role()::text in ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer'), false);
$$;

create or replace function public.product_library_rates_can_edit()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_is_active()
    and public.current_user_role()::text in ('system_owner','admin_manager','procurement_manager'), false);
$$;

create table if not exists public.product_library_default_rates (
  currency text primary key check (currency ~ '^[A-Z]{3}$' and currency <> 'AED'),
  rate_to_aed numeric(14, 6) not null check (rate_to_aed >= 0.0001 and rate_to_aed <= 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.product_library_default_rates enable row level security;
revoke all on public.product_library_default_rates from public, anon, authenticated;
grant select on public.product_library_default_rates to authenticated;
drop policy if exists product_library_default_rates_select on public.product_library_default_rates;
create policy product_library_default_rates_select on public.product_library_default_rates for select to authenticated
  using (public.product_library_rates_can_view());

-- Set (create or change) one default rate. Returns the saved row.
create or replace function public.set_product_library_default_rate(p_currency text, p_rate numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_currency text := upper(btrim(coalesce(p_currency, ''))); v_row public.product_library_default_rates;
begin
  if not public.product_library_rates_can_edit() then raise exception 'Not allowed.'; end if;
  if v_currency !~ '^[A-Z]{3}$' or v_currency = 'AED' then raise exception 'Invalid currency.'; end if;
  if p_rate is null or p_rate < 0.0001 or p_rate > 100000 then raise exception 'Invalid rate.'; end if;
  insert into public.product_library_default_rates (currency, rate_to_aed, updated_by)
  values (v_currency, round(p_rate, 6), auth.uid())
  on conflict (currency) do update set rate_to_aed = excluded.rate_to_aed, updated_at = now(), updated_by = excluded.updated_by
  returning * into v_row;
  return jsonb_build_object('currency', v_row.currency, 'rate_to_aed', v_row.rate_to_aed, 'updated_at', v_row.updated_at);
end $$;

-- Remove one default rate.
create or replace function public.remove_product_library_default_rate(p_currency text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.product_library_rates_can_edit() then raise exception 'Not allowed.'; end if;
  delete from public.product_library_default_rates where currency = upper(btrim(coalesce(p_currency, '')));
  return found;
end $$;

revoke all on function public.product_library_rates_can_view() from public, anon;
revoke all on function public.product_library_rates_can_edit() from public, anon;
revoke all on function public.set_product_library_default_rate(text, numeric) from public, anon;
revoke all on function public.remove_product_library_default_rate(text) from public, anon;
grant execute on function public.product_library_rates_can_view() to authenticated;
grant execute on function public.product_library_rates_can_edit() to authenticated;
grant execute on function public.set_product_library_default_rate(text, numeric) to authenticated;
grant execute on function public.remove_product_library_default_rate(text) to authenticated;
