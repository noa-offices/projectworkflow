create table if not exists public.product_template_row_references (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.product_templates(id) on delete cascade,
  pricing_type text not null check (pricing_type in ('workstation', 'base_model', 'finish_category', 'modular', 'accessory')),
  group_id text not null,
  row_id text not null,
  storage_path text not null unique,
  caption text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, pricing_type, group_id, row_id)
);

create index if not exists product_template_row_references_lookup_idx
on public.product_template_row_references (template_id, pricing_type, group_id, row_id);

drop trigger if exists product_template_row_references_set_updated_at on public.product_template_row_references;
create trigger product_template_row_references_set_updated_at before update on public.product_template_row_references
for each row execute function public.set_updated_at();

alter table public.product_template_row_references enable row level security;

create policy product_template_row_references_select_readable_template on public.product_template_row_references
for select to authenticated using (exists (select 1 from public.product_templates where product_templates.id = product_template_row_references.template_id));
create policy product_template_row_references_insert_managers on public.product_template_row_references
for insert to authenticated with check (public.current_user_can_manage_records() or public.current_user_is_sales_coordinator());
create policy product_template_row_references_update_managers on public.product_template_row_references
for update to authenticated using (public.current_user_can_manage_records() or public.current_user_is_sales_coordinator())
with check (public.current_user_can_manage_records() or public.current_user_is_sales_coordinator());
create policy product_template_row_references_delete_managers on public.product_template_row_references
for delete to authenticated using (public.current_user_can_manage_records() or public.current_user_is_sales_coordinator());

grant select, insert, update, delete on public.product_template_row_references to authenticated;
