alter table public.projects
add column if not exists attention_mobile text,
add column if not exists attention_landline text,
add column if not exists attention_email text,
add column if not exists po_box text,
add column if not exists project_address text;

create index if not exists projects_attention_mobile_idx
on public.projects (attention_mobile);

create index if not exists projects_attention_email_idx
on public.projects (attention_email);

create index if not exists projects_po_box_idx
on public.projects (po_box);
