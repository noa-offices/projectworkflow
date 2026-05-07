create table if not exists public.quotation_item_price_history (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  quotation_item_id uuid not null references public.quotation_items(id) on delete cascade,
  source_template_id uuid references public.product_templates(id),
  change_type text not null default 'manual',
  old_unit_price numeric,
  new_unit_price numeric not null,
  old_currency text,
  new_currency text,
  old_discount_value numeric,
  new_discount_value numeric,
  old_net_price numeric,
  new_net_price numeric,
  old_net_total numeric,
  new_net_total numeric,
  source_price_type text,
  source_price_label text,
  note text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  constraint quotation_item_price_history_change_type_check check (
    change_type in ('manual', 'use_current_source_price', 'revision_adjustment', 'other')
  )
);

create index if not exists quotation_item_price_history_quotation_id_idx
on public.quotation_item_price_history (quotation_id);

create index if not exists quotation_item_price_history_item_id_idx
on public.quotation_item_price_history (quotation_item_id);

create index if not exists quotation_item_price_history_source_template_id_idx
on public.quotation_item_price_history (source_template_id);

create index if not exists quotation_item_price_history_changed_at_idx
on public.quotation_item_price_history (changed_at desc);

alter table public.quotation_item_price_history enable row level security;

drop policy if exists quotation_item_price_history_select_active on public.quotation_item_price_history;

create policy quotation_item_price_history_select_active
on public.quotation_item_price_history
for select
to authenticated
using (public.current_user_is_active());

drop policy if exists quotation_item_price_history_select_managers on public.quotation_item_price_history;

create policy quotation_item_price_history_select_managers
on public.quotation_item_price_history
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists quotation_item_price_history_insert_record_managers on public.quotation_item_price_history;

create policy quotation_item_price_history_insert_record_managers
on public.quotation_item_price_history
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists quotation_item_price_history_update_record_managers on public.quotation_item_price_history;

create policy quotation_item_price_history_update_record_managers
on public.quotation_item_price_history
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

grant select, insert, update on public.quotation_item_price_history to authenticated;
