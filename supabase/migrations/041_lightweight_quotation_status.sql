alter table public.quotations
add column if not exists status_note text;

alter table public.quotations
add column if not exists status_updated_by uuid references public.profiles(id);

alter table public.quotations
add column if not exists status_updated_at timestamptz;

update public.quotations
set status = case
  when status = 'sent' then 'sent_to_client'
  when status = 'revised' then 'revision_required'
  when status in ('approved', 'won') then 'client_confirmed'
  when status = 'lost' then 'cancelled'
  else status
end
where status in ('sent', 'revised', 'approved', 'won', 'lost');

alter table public.quotations
drop constraint if exists quotations_status_check;

alter table public.quotations
add constraint quotations_status_check
check (
  status in (
    'draft',
    'internal_review',
    'revision_required',
    'ready_to_send',
    'sent_to_client',
    'client_confirmed',
    'cancelled',
    'archived'
  )
);
