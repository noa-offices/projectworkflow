create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  quotation_no text,
  revision_no integer not null default 0,
  title text not null,
  quotation_date date not null default current_date,
  status text not null default 'draft',
  currency text not null default 'AED',
  vat_percent numeric(5,2) not null default 5,
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  payment_terms text,
  validity text,
  delivery_terms text,
  warranty_terms text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotation_sections (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  section_title text not null,
  section_notes text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  section_id uuid references public.quotation_sections(id) on delete set null,
  item_type text not null default 'product',
  source_template_id uuid references public.product_templates(id) on delete set null,
  source_component_data jsonb,
  item_code_snapshot text,
  item_name_snapshot text,
  brand_name_snapshot text,
  category_name_snapshot text,
  specified_image_url_snapshot text,
  proposed_image_url_snapshot text,
  specification_snapshot text,
  selected_options_snapshot jsonb,
  internal_components_snapshot jsonb,
  qty numeric(12,2) not null default 1,
  unit_label text not null default 'Pc',
  unit_price numeric(14,2) not null default 0,
  discount_type text not null default 'amount',
  discount_value numeric(14,2) not null default 0,
  net_price numeric(14,2) not null default 0,
  net_total numeric(14,2) not null default 0,
  currency text not null default 'AED',
  sort_order integer not null default 0,
  is_optional boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotations_status_check'
      and conrelid = 'public.quotations'::regclass
  ) then
    alter table public.quotations
    add constraint quotations_status_check
    check (
      status in (
        'draft',
        'sent',
        'revised',
        'approved',
        'won',
        'lost',
        'cancelled'
      )
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_items_item_type_check'
      and conrelid = 'public.quotation_items'::regclass
  ) then
    alter table public.quotation_items
    add constraint quotation_items_item_type_check
    check (item_type in ('product', 'custom', 'note', 'blank', 'subtotal'));
  end if;
end $$;

create index if not exists quotations_client_id_idx
on public.quotations (client_id);

create index if not exists quotations_project_id_idx
on public.quotations (project_id);

create index if not exists quotations_quotation_no_idx
on public.quotations (quotation_no);

create index if not exists quotations_status_idx
on public.quotations (status);

create index if not exists quotation_sections_quotation_id_idx
on public.quotation_sections (quotation_id);

create index if not exists quotation_items_quotation_id_idx
on public.quotation_items (quotation_id);

create index if not exists quotation_items_section_id_idx
on public.quotation_items (section_id);

create index if not exists quotation_items_source_template_id_idx
on public.quotation_items (source_template_id);

create index if not exists quotation_items_sort_order_idx
on public.quotation_items (sort_order);

create unique index if not exists quotations_quotation_no_unique_idx
on public.quotations (lower(quotation_no))
where quotation_no is not null;

create unique index if not exists quotation_sections_active_title_unique_idx
on public.quotation_sections (quotation_id, lower(section_title))
where is_active = true;

drop trigger if exists quotations_set_updated_at on public.quotations;

create trigger quotations_set_updated_at
before update on public.quotations
for each row
execute function public.set_updated_at();

drop trigger if exists quotation_sections_set_updated_at on public.quotation_sections;

create trigger quotation_sections_set_updated_at
before update on public.quotation_sections
for each row
execute function public.set_updated_at();

drop trigger if exists quotation_items_set_updated_at on public.quotation_items;

create trigger quotation_items_set_updated_at
before update on public.quotation_items
for each row
execute function public.set_updated_at();

alter table public.quotations enable row level security;
alter table public.quotation_sections enable row level security;
alter table public.quotation_items enable row level security;

drop policy if exists quotations_select_active on public.quotations;

create policy quotations_select_active
on public.quotations
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists quotations_select_managers on public.quotations;

create policy quotations_select_managers
on public.quotations
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists quotations_insert_record_managers on public.quotations;

create policy quotations_insert_record_managers
on public.quotations
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists quotations_update_record_managers on public.quotations;

create policy quotations_update_record_managers
on public.quotations
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

drop policy if exists quotation_sections_select_active on public.quotation_sections;

create policy quotation_sections_select_active
on public.quotation_sections
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists quotation_sections_select_managers on public.quotation_sections;

create policy quotation_sections_select_managers
on public.quotation_sections
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists quotation_sections_insert_record_managers on public.quotation_sections;

create policy quotation_sections_insert_record_managers
on public.quotation_sections
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists quotation_sections_update_record_managers on public.quotation_sections;

create policy quotation_sections_update_record_managers
on public.quotation_sections
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

drop policy if exists quotation_items_select_active on public.quotation_items;

create policy quotation_items_select_active
on public.quotation_items
for select
to authenticated
using (
  is_active = true
  and public.current_user_is_active()
);

drop policy if exists quotation_items_select_managers on public.quotation_items;

create policy quotation_items_select_managers
on public.quotation_items
for select
to authenticated
using (public.current_user_can_manage_settings());

drop policy if exists quotation_items_insert_record_managers on public.quotation_items;

create policy quotation_items_insert_record_managers
on public.quotation_items
for insert
to authenticated
with check (public.current_user_can_manage_records());

drop policy if exists quotation_items_update_record_managers on public.quotation_items;

create policy quotation_items_update_record_managers
on public.quotation_items
for update
to authenticated
using (public.current_user_can_manage_records())
with check (public.current_user_can_manage_records());

grant select, insert, update on public.quotations to authenticated;
grant select, insert, update on public.quotation_sections to authenticated;
grant select, insert, update on public.quotation_items to authenticated;
