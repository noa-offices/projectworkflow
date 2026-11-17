-- My Collection custom items (PR 2b-1): private outside items with a SELLING price. NOT applied automatically.
-- No cost, no margin. One owner per row, private. Deleting is never blocked by anything.
-- This is a separate table from saved_setups on purpose: custom items have no product template, so they must
-- never be mixed into the "removed products" logic of saved_setups, and the strict recipe price guard stays untouched.
-- source_item_id / shared_by are reserved for the later "send to a user" step; nothing writes them yet.
-- image_path is reserved for PR 2b-3 (private bucket my-collection-images); it stays null in PR 2b-1.
-- Pattern copied from 20261112100000_saved_setups.sql (own-only RLS, current_user_is_active(), narrow grants).

create table if not exists public.saved_custom_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  brand_name text not null,
  item_name text not null,
  item_code text,
  specification text,
  unit_label text not null default 'Pc',
  selling_price numeric(14,2) not null,
  currency text not null default 'AED',
  image_path text,
  price_saved_at timestamptz not null default now(),
  source_item_id uuid references public.saved_custom_items(id) on delete set null,
  shared_by uuid references public.profiles(id) on delete set null,
  last_used_at timestamptz,
  use_count integer not null default 0 check (use_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_custom_items_brand_check check (char_length(btrim(brand_name)) between 1 and 80),
  constraint saved_custom_items_name_check check (char_length(btrim(item_name)) between 1 and 120),
  constraint saved_custom_items_code_check check (item_code is null or char_length(item_code) <= 60),
  constraint saved_custom_items_spec_check check (specification is null or char_length(specification) <= 4000),
  constraint saved_custom_items_unit_check check (char_length(btrim(unit_label)) between 1 and 20),
  constraint saved_custom_items_price_check check (selling_price >= 0 and selling_price < 1000000000),
  constraint saved_custom_items_currency_check check (currency in ('AED','EUR','USD')),
  constraint saved_custom_items_image_check check (image_path is null or (char_length(image_path) <= 300 and image_path like owner_id::text || '/%'))
);

create index if not exists saved_custom_items_owner_brand_name_idx
on public.saved_custom_items (owner_id, brand_name, item_name);

drop trigger if exists saved_custom_items_set_updated_at on public.saved_custom_items;
create trigger saved_custom_items_set_updated_at
before update on public.saved_custom_items
for each row execute function public.set_updated_at();

alter table public.saved_custom_items enable row level security;

drop policy if exists saved_custom_items_select_own on public.saved_custom_items;
create policy saved_custom_items_select_own
on public.saved_custom_items for select to authenticated
using (owner_id = (select auth.uid()) and (select public.current_user_is_active()));

drop policy if exists saved_custom_items_insert_own on public.saved_custom_items;
create policy saved_custom_items_insert_own
on public.saved_custom_items for insert to authenticated
with check (owner_id = (select auth.uid()) and (select public.current_user_is_active()));

drop policy if exists saved_custom_items_update_own on public.saved_custom_items;
create policy saved_custom_items_update_own
on public.saved_custom_items for update to authenticated
using (owner_id = (select auth.uid()) and (select public.current_user_is_active()))
with check (owner_id = (select auth.uid()));

drop policy if exists saved_custom_items_delete_own on public.saved_custom_items;
create policy saved_custom_items_delete_own
on public.saved_custom_items for delete to authenticated
using (owner_id = (select auth.uid()) and (select public.current_user_is_active()));

revoke all on public.saved_custom_items from public, anon, authenticated;
grant select, insert, delete on public.saved_custom_items to authenticated;
-- Ownership, id and provenance are immutable for ordinary callers.
grant update (brand_name, item_name, item_code, specification, unit_label, selling_price, currency,
              image_path, price_saved_at, last_used_at, use_count)
on public.saved_custom_items to authenticated;
