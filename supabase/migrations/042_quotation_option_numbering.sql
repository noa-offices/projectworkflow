alter table public.quotations
add column if not exists option_no integer not null default 1;

update public.quotations
set option_no = greatest(
  coalesce(
    ((regexp_match(
      regexp_replace(coalesce(quotation_no, ''), '(?:-R\d+)+$', '', 'i'),
      '\s+Option\s+(\d+)$',
      'i'
    ))[1])::integer,
    1
  ),
  1
);

alter table public.quotations
drop constraint if exists quotations_option_no_check;

alter table public.quotations
add constraint quotations_option_no_check
check (option_no >= 1);

create index if not exists quotations_project_option_no_idx
on public.quotations (project_id, option_no);
