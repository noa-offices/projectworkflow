create table if not exists public.product_template_group_references (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.product_templates(id) on delete cascade,
  pricing_type text not null,
  group_id text not null,
  storage_path text not null unique,
  display_order integer not null default 0,
  caption text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_template_group_references_pricing_type_check
    check (
      pricing_type in (
        'workstation',
        'base_model',
        'finish_category',
        'modular',
        'accessory'
      )
    )
);

comment on column public.product_template_group_references.storage_path is
  'Canonical object path in the private product-images bucket. G3B path convention: product-template-references/{template_id}/{pricing_type}/{group_id}/{reference_id}-{safe_filename}';

create index if not exists product_template_group_references_group_order_idx
on public.product_template_group_references (
  template_id,
  pricing_type,
  group_id,
  display_order
);

drop trigger if exists product_template_group_references_set_updated_at
on public.product_template_group_references;

create trigger product_template_group_references_set_updated_at
before update on public.product_template_group_references
for each row
execute function public.set_updated_at();

alter table public.product_template_group_references enable row level security;

drop policy if exists product_template_group_references_select_readable_template
on public.product_template_group_references;

create policy product_template_group_references_select_readable_template
on public.product_template_group_references
for select
to authenticated
using (
  exists (
    select 1
    from public.product_templates
    where product_templates.id = product_template_group_references.template_id
  )
);

drop policy if exists product_template_group_references_insert_managers
on public.product_template_group_references;

create policy product_template_group_references_insert_managers
on public.product_template_group_references
for insert
to authenticated
with check (
  public.current_user_can_manage_records()
  or public.current_user_is_sales_coordinator()
);

drop policy if exists product_template_group_references_update_managers
on public.product_template_group_references;

create policy product_template_group_references_update_managers
on public.product_template_group_references
for update
to authenticated
using (
  public.current_user_can_manage_records()
  or public.current_user_is_sales_coordinator()
)
with check (
  public.current_user_can_manage_records()
  or public.current_user_is_sales_coordinator()
);

drop policy if exists product_template_group_references_delete_managers
on public.product_template_group_references;

create policy product_template_group_references_delete_managers
on public.product_template_group_references
for delete
to authenticated
using (
  public.current_user_can_manage_records()
  or public.current_user_is_sales_coordinator()
);

grant select, insert, update, delete
on public.product_template_group_references
to authenticated;

drop policy if exists product_images_delete_record_managers on storage.objects;

create policy product_images_delete_record_managers
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and public.current_user_can_manage_records()
);
