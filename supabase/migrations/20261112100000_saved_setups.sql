-- My Collection (PR 1a): private saved product setups. NOT applied automatically.
-- A saved setup is ids + small overrides only. It never stores a price, total, exchange rate or line quantity;
-- prices are recalculated from the current price lists whenever a setup is used.
-- One owner per row, private. Deleting a product template is never blocked: template_id becomes null and the
-- row keeps brand_name / product_name so the owner can still see what it was.
-- source_setup_id / shared_by are reserved for the later "send to a user" step (PR 4); nothing writes them yet.
-- Pattern copied from 111_noa_sessions.sql (own-only RLS, current_user_is_active(), narrow grants).

create table if not exists public.saved_setups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  template_id uuid references public.product_templates(id) on delete set null,
  brand_id uuid,
  brand_name text not null,
  product_name text not null,
  setup_name text not null,
  note text,
  recipe jsonb not null,
  recipe_version integer not null default 1,
  spec_overrides jsonb not null default '{}'::jsonb,
  -- Hint only. pricing_version is a lock counter, never a "content changed" signal.
  template_pricing_version_at_save bigint,
  source_setup_id uuid references public.saved_setups(id) on delete set null,
  shared_by uuid references public.profiles(id) on delete set null,
  last_used_at timestamptz,
  use_count integer not null default 0 check (use_count >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_setups_name_check check (char_length(btrim(setup_name)) between 1 and 120),
  constraint saved_setups_recipe_object_check check (jsonb_typeof(recipe) = 'object'),
  constraint saved_setups_recipe_size_check check (octet_length(recipe::text) <= 65536),
  constraint saved_setups_spec_object_check check (jsonb_typeof(spec_overrides) = 'object'),
  constraint saved_setups_spec_size_check check (octet_length(spec_overrides::text) <= 65536)
);

create index if not exists saved_setups_owner_brand_product_idx
on public.saved_setups (owner_id, brand_name, product_name);

create index if not exists saved_setups_owner_template_idx
on public.saved_setups (owner_id, template_id);

drop trigger if exists saved_setups_set_updated_at on public.saved_setups;
create trigger saved_setups_set_updated_at
before update on public.saved_setups
for each row execute function public.set_updated_at();

alter table public.saved_setups enable row level security;

drop policy if exists saved_setups_select_own on public.saved_setups;
create policy saved_setups_select_own
on public.saved_setups for select to authenticated
using (owner_id = (select auth.uid()) and (select public.current_user_is_active()));

drop policy if exists saved_setups_insert_own on public.saved_setups;
create policy saved_setups_insert_own
on public.saved_setups for insert to authenticated
with check (owner_id = (select auth.uid()) and (select public.current_user_is_active()));

drop policy if exists saved_setups_update_own on public.saved_setups;
create policy saved_setups_update_own
on public.saved_setups for update to authenticated
using (owner_id = (select auth.uid()) and (select public.current_user_is_active()))
with check (owner_id = (select auth.uid()));

drop policy if exists saved_setups_delete_own on public.saved_setups;
create policy saved_setups_delete_own
on public.saved_setups for delete to authenticated
using (owner_id = (select auth.uid()) and (select public.current_user_is_active()));

revoke all on public.saved_setups from public, anon, authenticated;
grant select, insert, delete on public.saved_setups to authenticated;
-- Ownership, template link and provenance are immutable for ordinary callers.
grant update (setup_name, note, recipe, spec_overrides, last_used_at, use_count, archived)
on public.saved_setups to authenticated;
