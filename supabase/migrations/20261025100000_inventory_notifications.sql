-- Inventory notifications: managers hear about new requests, requesters hear about decisions.
-- Uses the existing public.notifications table and bell. AFTER triggers only: the existing
-- submit/review functions are not changed, and a notification problem can never break a request.
begin;

-- 1. New request arrives -> every active System Owner / Admin Manager (except the submitter).
create function inventory.notify_new_product_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sender uuid := auth.uid(); v_name text; v_role text;
begin
  begin
    if v_sender is null or new.request_status::text <> 'pending_review' then return new; end if;
    select p.full_name, p.role::text into v_name, v_role from public.profiles p where p.id = new.submitted_by;
    -- A manager's own request is applied at once: nothing to review.
    if v_role in ('system_owner', 'admin_manager') then return new; end if;
    insert into public.notifications (recipient_id, sender_id, body, order_no, sent_to_role)
    select m.id, v_sender,
      'New item request: ' || left(regexp_replace(coalesce(new.item_name, ''), '\s+', ' ', 'g'), 80)
        || ' from ' || left(regexp_replace(coalesce(nullif(trim(v_name), ''), 'a team member'), '\s+', ' ', 'g'), 60),
      '/inventory/requests?tab=products&status=pending_review', 'inventory_managers'
    from public.profiles m
    where m.role::text in ('system_owner', 'admin_manager') and m.account_status::text = 'active' and m.id <> new.submitted_by;
  exception when others then null;  -- never fail the request because of a notification
  end;
  return new;
end $$;

create function inventory.notify_new_movement_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sender uuid := auth.uid(); v_name text; v_role text; v_item text;
begin
  begin
    if v_sender is null or new.request_status::text <> 'pending_review' then return new; end if;
    select p.full_name, p.role::text into v_name, v_role from public.profiles p where p.id = new.submitted_by;
    if v_role in ('system_owner', 'admin_manager') then return new; end if;
    select i.item_name into v_item from inventory.products i where i.id = new.product_id;
    insert into public.notifications (recipient_id, sender_id, body, order_no, sent_to_role)
    select m.id, v_sender,
      initcap(left(regexp_replace(coalesce(new.request_type, 'stock'), '[^a-z]', '', 'g'), 10)) || ' request: '
        || left(regexp_replace(coalesce(v_item, 'an item'), '\s+', ' ', 'g'), 80) || ' x' || new.quantity::text
        || ' from ' || left(regexp_replace(coalesce(nullif(trim(v_name), ''), 'a team member'), '\s+', ' ', 'g'), 60),
      '/inventory/requests?tab=movements&status=pending_review', 'inventory_managers'
    from public.profiles m
    where m.role::text in ('system_owner', 'admin_manager') and m.account_status::text = 'active' and m.id <> new.submitted_by;
  exception when others then null;
  end;
  return new;
end $$;

-- 2. Request decided -> the person who asked (not the reviewer himself).
create function inventory.notify_product_request_decided()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sender uuid := auth.uid(); v_word text; v_note text;
begin
  begin
    if v_sender is null or new.submitted_by = v_sender then return new; end if;
    v_word := case new.request_status::text when 'approved' then 'approved' else 'rejected' end;
    v_note := left(regexp_replace(coalesce(new.review_note, ''), '\s+', ' ', 'g'), 140);
    insert into public.notifications (recipient_id, sender_id, body, order_no)
    select p.id, v_sender,
      'Your request for ' || left(regexp_replace(coalesce(new.item_name, 'an item'), '\s+', ' ', 'g'), 80) || ' was ' || v_word
        || case when trim(v_note) <> '' then ': ' || trim(v_note) else '' end,
      '/inventory/requests?tab=products&status=' || v_word
    from public.profiles p where p.id = new.submitted_by and p.account_status::text = 'active';
  exception when others then null;
  end;
  return new;
end $$;

create function inventory.notify_movement_request_decided()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sender uuid := auth.uid(); v_word text; v_note text; v_item text;
begin
  begin
    if v_sender is null or new.submitted_by = v_sender then return new; end if;
    v_word := case new.request_status::text when 'approved' then 'approved' else 'rejected' end;
    v_note := left(regexp_replace(coalesce(new.review_note, ''), '\s+', ' ', 'g'), 140);
    select i.item_name into v_item from inventory.products i where i.id = new.product_id;
    insert into public.notifications (recipient_id, sender_id, body, order_no)
    select p.id, v_sender,
      'Your ' || lower(left(regexp_replace(coalesce(new.request_type, 'stock'), '[^a-z]', '', 'g'), 10)) || ' request for '
        || left(regexp_replace(coalesce(v_item, 'an item'), '\s+', ' ', 'g'), 80) || ' was ' || v_word
        || case when trim(v_note) <> '' then ': ' || trim(v_note) else '' end,
      '/inventory/requests?tab=movements&status=' || v_word
    from public.profiles p where p.id = new.submitted_by and p.account_status::text = 'active';
  exception when others then null;
  end;
  return new;
end $$;

-- Trigger functions run only from triggers: nobody can call them directly.
revoke all on function inventory.notify_new_product_request() from public, anon, authenticated, service_role;
revoke all on function inventory.notify_new_movement_request() from public, anon, authenticated, service_role;
revoke all on function inventory.notify_product_request_decided() from public, anon, authenticated, service_role;
revoke all on function inventory.notify_movement_request_decided() from public, anon, authenticated, service_role;

create trigger notify_new_product_request after insert on inventory.product_requests
  for each row when (new.request_status::text = 'pending_review') execute function inventory.notify_new_product_request();
create trigger notify_new_movement_request after insert on inventory.movement_requests
  for each row when (new.request_status::text = 'pending_review') execute function inventory.notify_new_movement_request();
create trigger notify_product_request_decided after update of request_status on inventory.product_requests
  for each row when (old.request_status::text = 'pending_review' and new.request_status::text in ('approved', 'rejected'))
  execute function inventory.notify_product_request_decided();
create trigger notify_movement_request_decided after update of request_status on inventory.movement_requests
  for each row when (old.request_status::text = 'pending_review' and new.request_status::text in ('approved', 'rejected'))
  execute function inventory.notify_movement_request_decided();
commit;

-- ROLLBACK (manual).
-- begin;
-- drop trigger if exists notify_new_product_request on inventory.product_requests;
-- drop trigger if exists notify_new_movement_request on inventory.movement_requests;
-- drop trigger if exists notify_product_request_decided on inventory.product_requests;
-- drop trigger if exists notify_movement_request_decided on inventory.movement_requests;
-- drop function if exists inventory.notify_new_product_request(), inventory.notify_new_movement_request(),
--   inventory.notify_product_request_decided(), inventory.notify_movement_request_decided();
-- commit;
