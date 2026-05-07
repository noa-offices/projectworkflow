alter table public.product_template_material_groups
add column if not exists selection_mode text not null default 'full_group';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_template_material_groups_selection_mode_check'
  ) then
    alter table public.product_template_material_groups
    add constraint product_template_material_groups_selection_mode_check
    check (selection_mode in ('full_group', 'selected_items'));
  end if;
end $$;

create table if not exists public.product_template_material_group_items (
  id uuid primary key default gen_random_uuid(),
  product_template_material_group_id uuid not null references public.product_template_material_groups(id) on delete cascade,
  brand_material_id uuid not null references public.brand_materials(id) on delete cascade,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_template_material_group_items_unique unique (product_template_material_group_id, brand_material_id)
);

create index if not exists product_template_material_group_items_link_id_idx
on public.product_template_material_group_items (product_template_material_group_id);

create index if not exists product_template_material_group_items_brand_material_id_idx
on public.product_template_material_group_items (brand_material_id);

drop trigger if exists product_template_material_group_items_set_updated_at on public.product_template_material_group_items;

create trigger product_template_material_group_items_set_updated_at
before update on public.product_template_material_group_items
for each row
execute function public.set_updated_at();

alter table public.product_template_material_group_items enable row level security;

drop policy if exists product_template_material_group_items_select_active on public.product_template_material_group_items;

create policy product_template_material_group_items_select_active
on public.product_template_material_group_items
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists product_template_material_group_items_select_managers on public.product_template_material_group_items;

create policy product_template_material_group_items_select_managers
on public.product_template_material_group_items
for select
to authenticated
using (public.current_user_can_manage_records());

drop policy if exists product_template_material_group_items_insert_managers on public.product_template_material_group_items;

create policy product_template_material_group_items_insert_managers
on public.product_template_material_group_items
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists product_template_material_group_items_update_managers on public.product_template_material_group_items;

create policy product_template_material_group_items_update_managers
on public.product_template_material_group_items
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

drop policy if exists product_template_material_group_items_delete_managers on public.product_template_material_group_items;

create policy product_template_material_group_items_delete_managers
on public.product_template_material_group_items
for delete
to authenticated
using (public.current_user_can_manage_records());

grant select, insert, update, delete on public.product_template_material_group_items to authenticated;
