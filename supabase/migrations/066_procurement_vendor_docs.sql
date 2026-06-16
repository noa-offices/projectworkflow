-- Requires storage bucket "project-documents" to exist in Supabase Storage.
-- Create it manually in the Supabase dashboard with public or authenticated access.

create table if not exists public.procurement_vendor_docs (
  id            uuid        primary key default gen_random_uuid(),
  order_no      text        not null,
  quotation_id  uuid        not null references public.quotations(id) on delete cascade,
  vendor_key    text        not null,
  slot_key      text        not null,
  file_name     text        not null,
  storage_path  text        not null,
  public_url    text        not null,
  created_at    timestamptz not null default now(),
  created_by    uuid        references auth.users(id),

  constraint procurement_vendor_docs_unique_slot unique (order_no, vendor_key, slot_key)
);

alter table public.procurement_vendor_docs enable row level security;

create policy "Active users can select procurement_vendor_docs"
  on public.procurement_vendor_docs
  for select
  to authenticated
  using (public.current_user_is_active());

create policy "Procurement users can insert procurement_vendor_docs"
  on public.procurement_vendor_docs
  for insert
  to authenticated
  with check (public.current_user_can_access_procurement());

create policy "Procurement users can delete procurement_vendor_docs"
  on public.procurement_vendor_docs
  for delete
  to authenticated
  using (public.current_user_can_access_procurement());

grant select, insert, delete on public.procurement_vendor_docs to authenticated;
