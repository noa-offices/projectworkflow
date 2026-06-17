-- Multi-file support: allow multiple rows per slot. Drop the single-file unique constraints.
alter table public.project_document_attachments
  drop constraint if exists project_document_attachments_unique_slot;

alter table public.procurement_vendor_docs
  drop constraint if exists procurement_vendor_docs_unique_slot;
