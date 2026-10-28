-- Task 20: manual application only. No rows are deleted or hidden by RLS.
drop policy if exists product_requests_select on inventory.product_requests;
create policy product_requests_select on inventory.product_requests for select to authenticated
using (inventory.can_manage() or (inventory.can_view() and submitted_by = (select auth.uid())));
drop policy if exists movement_requests_select on inventory.movement_requests;
create policy movement_requests_select on inventory.movement_requests for select to authenticated
using (inventory.can_manage() or (inventory.can_view() and submitted_by = (select auth.uid())));
drop policy if exists movements_select on inventory.movements;
create policy movements_select on inventory.movements for select to authenticated using (inventory.can_manage());

-- Request photos are private. Product-linked photos remain visible to inventory viewers.
drop policy if exists product_images_select on inventory.product_images;
create policy product_images_select on inventory.product_images for select to authenticated
using (inventory.can_manage() or (inventory.can_view() and (
 product_id is not null or exists (select 1 from inventory.product_requests r
 where r.id=product_images.product_request_id and r.submitted_by=(select auth.uid()))
)));
-- Allow product paths, own request paths (including before metadata insert), and
-- product-linked images that retain their original request path after approval.
drop policy if exists inventory_images_select on storage.objects;
create policy inventory_images_select on storage.objects for select to authenticated
using (bucket_id='inventory-images' and (inventory.can_manage() or (inventory.can_view() and (
 (storage.foldername(name))[1]='products'
 or exists (select 1 from inventory.product_requests r where r.id::text=(storage.foldername(name))[2]
   and (storage.foldername(name))[1]='requests' and r.submitted_by=(select auth.uid()))
 or exists (select 1 from inventory.product_images i where i.storage_bucket=objects.bucket_id
   and i.storage_path=objects.name and i.product_id is not null)
))));

-- Restrictive because existing permissive policies include a sales-coordinator policy.
-- Inventory activity contains actor names, request details and movements.
create policy task20_inventory_activity_manager_only on public.audit_activity_log
as restrictive for select to authenticated
using (entity_type not like 'inventory\_%' escape '\' or inventory.can_manage());

-- Senders who are managers retain their sent-notification read status view.
drop policy if exists "Senders can select notifications they sent" on public.notifications;
create policy "Senders can select notifications they sent" on public.notifications for select to authenticated
using (sender_id = (select auth.uid()) and inventory.can_manage());

alter table inventory.product_requests
 add column cleared_at timestamptz,
 add column cleared_by uuid references public.profiles(id) on delete set null,
 add constraint product_requests_pending_not_cleared check (request_status <> 'pending_review' or cleared_at is null);
alter table inventory.movement_requests
 add column cleared_at timestamptz,
 add column cleared_by uuid references public.profiles(id) on delete set null,
 add constraint movement_requests_pending_not_cleared check (request_status <> 'pending_review' or cleared_at is null);

create or replace function inventory.person_names(p_ids uuid[])
returns table (id uuid, full_name text) language plpgsql stable security definer set search_path = '' as $$
begin
 if not coalesce(inventory.can_view(), false) then raise exception 'Inventory access denied' using errcode='42501'; end if;
 if coalesce(cardinality(p_ids),0)>200 then raise exception 'At most 200 ids per call' using errcode='22023'; end if;
 return query select p.id,p.full_name from public.profiles p
 where p.id=any(p_ids) and (p.id=auth.uid() or (inventory.can_manage() and (inventory.is_record_actor(p.id)
 or exists(select 1 from inventory.product_requests r where r.cleared_by=p.id)
 or exists(select 1 from inventory.movement_requests r where r.cleared_by=p.id))));
end $$;
revoke all on function inventory.person_names(uuid[]) from public,anon,authenticated,service_role;
grant execute on function inventory.person_names(uuid[]) to authenticated;

create or replace function inventory.search_people(term text)
returns table (id uuid) language plpgsql stable security definer set search_path = '' as $$
declare needle text := btrim(coalesce(term,''));
begin
 if not coalesce(inventory.can_manage(),false) then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 if char_length(needle)<2 then return; end if;
 needle := replace(replace(replace(needle, chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_');
 return query select p.id from public.profiles p where p.full_name ilike '%'||needle||'%' escape chr(92)
 and inventory.is_record_actor(p.id) order by p.id limit 100;
end $$;
revoke all on function inventory.search_people(text) from public,anon,authenticated,service_role;
grant execute on function inventory.search_people(text) to authenticated;

create function inventory.clear_finished_requests(p_kind text, p_before timestamptz default null)
returns table(product_count bigint, movement_count bigint) language plpgsql security definer set search_path = '' as $$
declare a bigint := 0; b bigint := 0;
begin
 if auth.uid() is null or not coalesce(inventory.can_manage(),false) then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('product','movement','all') then raise exception 'Invalid request kind' using errcode='22023'; end if;
 if p_kind in ('product','all') then
  update inventory.product_requests set cleared_at=now(),cleared_by=auth.uid()
  where request_status in ('approved','rejected') and cleared_at is null and (p_before is null or reviewed_at<=p_before);
  get diagnostics a = row_count;
 end if;
 if p_kind in ('movement','all') then
  update inventory.movement_requests set cleared_at=now(),cleared_by=auth.uid()
  where request_status in ('approved','rejected') and cleared_at is null and (p_before is null or reviewed_at<=p_before);
  get diagnostics b = row_count;
 end if;
 return query select a,b;
end $$;
create function inventory.restore_cleared_requests(p_kind text)
returns table(product_count bigint, movement_count bigint) language plpgsql security definer set search_path = '' as $$
declare a bigint := 0; b bigint := 0;
begin
 if auth.uid() is null or not coalesce(inventory.can_manage(),false) then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('product','movement','all') then raise exception 'Invalid request kind' using errcode='22023'; end if;
 if p_kind in ('product','all') then update inventory.product_requests set cleared_at=null,cleared_by=null where cleared_at is not null; get diagnostics a = row_count; end if;
 if p_kind in ('movement','all') then update inventory.movement_requests set cleared_at=null,cleared_by=null where cleared_at is not null; get diagnostics b = row_count; end if;
 return query select a,b;
end $$;
create function inventory.restore_cleared_request(p_kind text,p_id uuid)
returns table(product_count bigint, movement_count bigint) language plpgsql security definer set search_path = '' as $$
declare a bigint := 0; b bigint := 0;
begin
 if auth.uid() is null or not coalesce(inventory.can_manage(),false) then raise exception 'Inventory management permission required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('product','movement') or p_id is null then raise exception 'Invalid request kind or id' using errcode='22023'; end if;
 if p_kind='product' then update inventory.product_requests set cleared_at=null,cleared_by=null where id=p_id and cleared_at is not null; get diagnostics a = row_count;
 else update inventory.movement_requests set cleared_at=null,cleared_by=null where id=p_id and cleared_at is not null; get diagnostics b = row_count; end if;
 return query select a,b;
end $$;
revoke all on function inventory.clear_finished_requests(text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function inventory.restore_cleared_requests(text) from public,anon,authenticated,service_role;
revoke all on function inventory.restore_cleared_request(text,uuid) from public,anon,authenticated,service_role;
grant execute on function inventory.clear_finished_requests(text,timestamptz) to authenticated;
grant execute on function inventory.restore_cleared_requests(text) to authenticated;
grant execute on function inventory.restore_cleared_request(text,uuid) to authenticated;
