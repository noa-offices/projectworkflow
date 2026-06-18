create table if not exists public.notifications (
  id           uuid        primary key default gen_random_uuid(),
  recipient_id uuid        not null references public.profiles(id) on delete cascade,
  sender_id    uuid        not null references public.profiles(id),
  body         text        not null,
  order_no     text,
  sent_to_role text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_recipient_read_idx
  on public.notifications (recipient_id, read_at);

create index if not exists notifications_sender_idx
  on public.notifications (sender_id);

alter table public.notifications enable row level security;

-- Recipients can read their own notifications
create policy "Recipients can select their own notifications"
  on public.notifications
  for select
  to authenticated
  using (recipient_id = auth.uid() and public.current_user_is_active());

-- Senders can see read status of notifications they sent
create policy "Senders can select notifications they sent"
  on public.notifications
  for select
  to authenticated
  using (sender_id = auth.uid() and public.current_user_is_active());

-- Recipients can mark their own notifications as read (read_at only)
create policy "Recipients can update their own notifications"
  on public.notifications
  for update
  to authenticated
  using (recipient_id = auth.uid() and public.current_user_is_active())
  with check (recipient_id = auth.uid());

grant select, insert, update on public.notifications to authenticated;
