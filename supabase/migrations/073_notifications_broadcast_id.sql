-- Add broadcast_id to group rows belonging to the same sendNotificationToRole() call.
-- Rows inserted before this migration will have broadcast_id = null and continue to
-- be grouped by the legacy (sent_to_role, order_no, body) fallback in getSentNotifications().

alter table public.notifications
  add column if not exists broadcast_id uuid;

create index if not exists notifications_broadcast_id_idx
  on public.notifications (broadcast_id)
  where broadcast_id is not null;
