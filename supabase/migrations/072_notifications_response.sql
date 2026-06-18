-- Add response-tracking columns to notifications.
-- Grant analysis: migration 071 already has
--   grant select, insert, update on public.notifications to authenticated
-- The existing UPDATE RLS policy (recipient_id = auth.uid()) is column-agnostic
-- and already covers updating the new `response` column. No new grants or policies needed.

alter table public.notifications
  add column if not exists requires_response boolean not null default false,
  add column if not exists response          text;

alter table public.notifications
  add constraint notifications_response_check
  check (response in ('accepted', 'declined') or response is null);

create index if not exists notifications_response_idx
  on public.notifications (recipient_id, requires_response)
  where requires_response = true;
