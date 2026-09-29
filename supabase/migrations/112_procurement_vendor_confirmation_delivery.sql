-- Procurement Task 1: explicit supplier confirmation + simple vendor-level receiving status.
-- Additive only - existing rows keep working with a safe default, the existing unique
-- (order_no, vendor_key) grain is untouched, and no column here is read from/derived from
-- active_step (confirmation and receiving are independent facts, never inferred from the step).
alter table public.procurement_vendor_progress
add column if not exists supplier_confirmed_at timestamptz,
add column if not exists supplier_confirmed_by uuid references auth.users(id),
add column if not exists receiving_status text not null default 'pending',
add column if not exists received_at timestamptz;

-- Closed, simple status set only - vendor-group grain, never per-line/per-quantity.
alter table public.procurement_vendor_progress
drop constraint if exists procurement_vendor_progress_receiving_status_check;

alter table public.procurement_vendor_progress
add constraint procurement_vendor_progress_receiving_status_check
check (receiving_status in ('pending', 'partial', 'received'));

-- received_at is meaningful only once status is "received" - never a stale leftover once the
-- status moves away from it. Existing rows all default to pending/null, so this holds trivially.
alter table public.procurement_vendor_progress
drop constraint if exists procurement_vendor_progress_received_at_check;

alter table public.procurement_vendor_progress
add constraint procurement_vendor_progress_received_at_check
check (received_at is null or receiving_status = 'received');
