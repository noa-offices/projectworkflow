-- ProjectWorkflow patch
-- Add flexible option_type to product_components

alter table public.product_components
add column if not exists option_type text not null default 'other';

alter table public.product_components
drop constraint if exists product_components_option_type_check;

alter table public.product_components
add constraint product_components_option_type_check
check (
  option_type in (
    'material_finish',
    'fabric_category',
    'size_variant',
    'cluster_preset',
    'linked_addon',
    'other'
  )
);

create index if not exists product_components_option_type_idx
on public.product_components (option_type);