-- Project-level purchase order records (one row per vendor per confirmed order)
create table if not exists public.project_purchase_orders (
  id          uuid        primary key default gen_random_uuid(),
  order_no    text        not null,
  quotation_id uuid       not null references public.quotations(id) on delete cascade,
  po_number   text        not null,
  vendor_key  text        not null,
  vendor_label text       not null,
  items_snapshot jsonb    not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  created_by  uuid        references auth.users(id),

  constraint project_purchase_orders_order_no_po_number_unique unique (order_no, po_number)
);

alter table public.project_purchase_orders enable row level security;

create policy "Procurement users can select project_purchase_orders"
  on public.project_purchase_orders
  for select
  to authenticated
  using (public.current_user_can_access_procurement());

create policy "Procurement users can insert project_purchase_orders"
  on public.project_purchase_orders
  for insert
  to authenticated
  with check (public.current_user_can_access_procurement());

grant select, insert on public.project_purchase_orders to authenticated;
