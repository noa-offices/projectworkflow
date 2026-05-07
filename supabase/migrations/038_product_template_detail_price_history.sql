create table if not exists public.product_template_detail_price_history (
  id uuid primary key default gen_random_uuid(),
  product_template_id uuid not null references public.product_templates(id) on delete cascade,
  brand_id uuid references public.brands(id),
  brand_price_list_update_id uuid references public.brand_price_list_updates(id),
  source_table text not null,
  source_record_id text not null,
  price_field text not null,
  old_price numeric,
  new_price numeric not null,
  currency text,
  effective_from date,
  note text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  constraint product_template_detail_price_history_source_check check (
    source_table in (
      'product_components',
      'product_templates.desking_size_pricing',
      'product_templates.variant_pricing',
      'product_templates.category_pricing',
      'product_templates.accessory_pricing'
    )
  ),
  constraint product_template_detail_price_history_price_field_check check (
    price_field in (
      'unit_price',
      'default_price',
      'additional_price',
      'price',
      'prices.Cat A',
      'prices.Cat B',
      'prices.Cat C',
      'prices.Cat D'
    )
  )
);

create index if not exists product_template_detail_price_history_template_id_idx
on public.product_template_detail_price_history (product_template_id);

create index if not exists product_template_detail_price_history_brand_id_idx
on public.product_template_detail_price_history (brand_id);

create index if not exists product_template_detail_price_history_price_list_update_id_idx
on public.product_template_detail_price_history (brand_price_list_update_id);

create index if not exists product_template_detail_price_history_source_idx
on public.product_template_detail_price_history (source_table, source_record_id);

alter table public.product_template_detail_price_history enable row level security;

drop policy if exists product_template_detail_price_history_select_active_users on public.product_template_detail_price_history;

create policy product_template_detail_price_history_select_active_users
on public.product_template_detail_price_history
for select
to authenticated
using (public.current_user_is_active());

drop policy if exists product_template_detail_price_history_insert_managers on public.product_template_detail_price_history;

create policy product_template_detail_price_history_insert_managers
on public.product_template_detail_price_history
for insert
to authenticated
with check (public.current_user_can_manage_records());

grant select, insert on public.product_template_detail_price_history to authenticated;
