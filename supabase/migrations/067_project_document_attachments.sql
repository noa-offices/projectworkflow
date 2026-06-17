create table if not exists public.project_document_attachments (
  id            uuid        primary key default gen_random_uuid(),
  order_no      text        not null,
  slot_key      text        not null,
  file_name     text        not null,
  storage_path  text        not null,
  public_url    text        not null,
  created_at    timestamptz not null default now(),
  created_by    uuid        references auth.users(id),

  constraint project_document_attachments_unique_slot unique (order_no, slot_key)
);

alter table public.project_document_attachments enable row level security;

create policy "Active users can select project_document_attachments"
  on public.project_document_attachments
  for select
  to authenticated
  using (public.current_user_is_active());

create policy "Record managers can insert project_document_attachments"
  on public.project_document_attachments
  for insert
  to authenticated
  with check (public.current_user_can_manage_records());

create policy "Record managers can delete project_document_attachments"
  on public.project_document_attachments
  for delete
  to authenticated
  using (public.current_user_can_manage_records());

grant select, insert, delete on public.project_document_attachments to authenticated;
