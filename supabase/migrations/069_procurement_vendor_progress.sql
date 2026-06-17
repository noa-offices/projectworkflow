create table if not exists public.procurement_vendor_progress (
  id            uuid        primary key default gen_random_uuid(),
  order_no      text        not null,
  vendor_key    text        not null,
  active_step   int         not null default 0,
  etd           text,
  eta           text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid        references auth.users(id),

  constraint procurement_vendor_progress_unique unique (order_no, vendor_key)
);

alter table public.procurement_vendor_progress enable row level security;

create policy "Active users can select procurement_vendor_progress"
  on public.procurement_vendor_progress
  for select
  to authenticated
  using (public.current_user_is_active());

create policy "Procurement users can insert procurement_vendor_progress"
  on public.procurement_vendor_progress
  for insert
  to authenticated
  with check (public.current_user_can_access_procurement());

create policy "Procurement users can update procurement_vendor_progress"
  on public.procurement_vendor_progress
  for update
  to authenticated
  using (public.current_user_can_access_procurement());

grant select, insert, update on public.procurement_vendor_progress to authenticated;
