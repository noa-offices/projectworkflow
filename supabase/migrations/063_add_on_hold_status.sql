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
    'on_hold',
    'cancelled',
    'archived'
  )
);
