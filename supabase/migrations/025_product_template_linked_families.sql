create table if not exists public.product_template_linked_families (
  id uuid primary key default gen_random_uuid(),
  parent_template_id uuid not null references public.product_templates(id) on delete cascade,
  linked_template_id uuid not null references public.product_templates(id) on delete cascade,
  label text,
  is_required boolean not null default false,
  allow_multiple boolean not null default true,
  add_to_parent_price boolean not null default true,
  append_to_specification boolean not null default true,
  default_qty numeric not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(parent_template_id, linked_template_id)
);

create index if not exists product_template_linked_families_parent_idx
on public.product_template_linked_families (parent_template_id);

create index if not exists product_template_linked_families_linked_idx
on public.product_template_linked_families (linked_template_id);

drop trigger if exists product_template_linked_families_set_updated_at on public.product_template_linked_families;

create trigger product_template_linked_families_set_updated_at
before update on public.product_template_linked_families
for each row execute function public.set_updated_at();

alter table public.product_template_linked_families enable row level security;

drop policy if exists product_template_linked_families_select_active on public.product_template_linked_families;

create policy product_template_linked_families_select_active
on public.product_template_linked_families
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists product_template_linked_families_select_managers on public.product_template_linked_families;

create policy product_template_linked_families_select_managers
on public.product_template_linked_families
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists product_template_linked_families_insert_managers on public.product_template_linked_families;

create policy product_template_linked_families_insert_managers
on public.product_template_linked_families
for insert
to authenticated
with check (public.current_user_can_manage_settings());

drop policy if exists product_template_linked_families_update_managers on public.product_template_linked_families;

create policy product_template_linked_families_update_managers
on public.product_template_linked_families
for update
to authenticated
using (public.current_user_can_manage_settings())
with check (public.current_user_can_manage_settings());

grant select, insert, update on public.product_template_linked_families to authenticated;
