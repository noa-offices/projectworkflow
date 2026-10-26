-- Task 14: Stock ref first in future Inventory notification bodies.
-- UNAPPLIED: user tests/applies this migration. No tables, policies, grants or request logic change.
-- Historical bodies are untouched because they contain no reliable item/request id.
begin;

-- 1. New request arrives -> every active System Owner / Admin Manager (except the submitter).
create or replace function inventory.notify_new_product_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sender uuid := auth.uid(); v_name text; v_role text; v_identifier text;
begin
  begin
    if v_sender is null or new.request_status::text <> 'pending_review' then return new; end if;
    select p.full_name, p.role::text into v_name, v_role from public.profiles p where p.id = new.submitted_by;
    v_identifier := concat_ws(' · ', coalesce(nullif(btrim(new.stock_ref), ''), 'Ref assigned on approval'), case when nullif(btrim(new.item_code), '') is not null then 'Code ' || btrim(new.item_code) end, case when nullif(btrim(new.model_name), '') is not null then 'Model ' || btrim(new.model_name) end);
    -- A manager's own request is applied at once: nothing to review.
    if v_role in ('system_owner', 'admin_manager') then return new; end if;
    insert into public.notifications (recipient_id, sender_id, body, order_no, sent_to_role)
    select m.id, v_sender,
      'New item request: ' || left(regexp_replace(coalesce(new.item_name, ''), '\s+', ' ', 'g'), 80) || E'\n' || v_identifier
        || ' from ' || left(regexp_replace(coalesce(nullif(trim(v_name), ''), 'a team member'), '\s+', ' ', 'g'), 60),
      '/inventory/requests?tab=products&status=pending_review', 'inventory_managers'
    from public.profiles m
    where m.role::text in ('system_owner', 'admin_manager') and m.account_status::text = 'active' and m.id <> new.submitted_by;
  exception when others then null;  -- never fail the request because of a notification
  end;
  return new;
end $$;

create or replace function inventory.notify_new_movement_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sender uuid := auth.uid(); v_name text; v_role text; v_item text; v_ref text; v_code text; v_model text; v_identifier text;
begin
  begin
    if v_sender is null or new.request_status::text <> 'pending_review' then return new; end if;
    select p.full_name, p.role::text into v_name, v_role from public.profiles p where p.id = new.submitted_by;
    if v_role in ('system_owner', 'admin_manager') then return new; end if;
    select i.item_name, i.stock_ref, i.item_code, i.model_name into v_item, v_ref, v_code, v_model from inventory.products i where i.id = new.product_id;
    v_identifier := concat_ws(' · ', coalesce(nullif(btrim(v_ref), ''), 'Ref assigned on approval'), case when nullif(btrim(v_code), '') is not null then 'Code ' || btrim(v_code) end, case when nullif(btrim(v_model), '') is not null then 'Model ' || btrim(v_model) end);
    insert into public.notifications (recipient_id, sender_id, body, order_no, sent_to_role)
    select m.id, v_sender,
      initcap(left(regexp_replace(coalesce(new.request_type, 'stock'), '[^a-z]', '', 'g'), 10)) || ' request: '
        || left(regexp_replace(coalesce(v_item, 'an item'), '\s+', ' ', 'g'), 80) || E'\n' || v_identifier || ' x' || new.quantity::text
        || ' from ' || left(regexp_replace(coalesce(nullif(trim(v_name), ''), 'a team member'), '\s+', ' ', 'g'), 60),
      '/inventory/requests?tab=movements&status=pending_review', 'inventory_managers'
    from public.profiles m
    where m.role::text in ('system_owner', 'admin_manager') and m.account_status::text = 'active' and m.id <> new.submitted_by;
  exception when others then null;
  end;
  return new;
end $$;

-- 2. Request decided -> the person who asked (not the reviewer himself).
create or replace function inventory.notify_product_request_decided()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sender uuid := auth.uid(); v_word text; v_note text; v_ref text; v_code text; v_model text; v_identifier text;
begin
  begin
    if v_sender is null or new.submitted_by = v_sender then return new; end if;
    v_word := case new.request_status::text when 'approved' then 'approved' else 'rejected' end;
    v_note := left(regexp_replace(coalesce(new.review_note, ''), '\s+', ' ', 'g'), 140);
    select p.stock_ref, p.item_code, p.model_name into v_ref, v_code, v_model from inventory.products p where p.id = new.approved_product_id;
    v_identifier := concat_ws(' · ', coalesce(nullif(btrim(coalesce(v_ref,new.stock_ref)), ''), 'Ref assigned on approval'), case when nullif(btrim(coalesce(v_code,new.item_code)), '') is not null then 'Code ' || btrim(coalesce(v_code,new.item_code)) end, case when nullif(btrim(coalesce(v_model,new.model_name)), '') is not null then 'Model ' || btrim(coalesce(v_model,new.model_name)) end);
    insert into public.notifications (recipient_id, sender_id, body, order_no)
    select p.id, v_sender,
      'Your request for ' || left(regexp_replace(coalesce(new.item_name, 'an item'), '\s+', ' ', 'g'), 80) || E'\n' || v_identifier || ' was ' || v_word
        || case when trim(v_note) <> '' then ': ' || trim(v_note) else '' end,
      '/inventory/requests?tab=products&status=' || v_word
    from public.profiles p where p.id = new.submitted_by and p.account_status::text = 'active';
  exception when others then null;
  end;
  return new;
end $$;

create or replace function inventory.notify_movement_request_decided()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sender uuid := auth.uid(); v_word text; v_note text; v_item text; v_ref text; v_code text; v_model text; v_identifier text;
begin
  begin
    if v_sender is null or new.submitted_by = v_sender then return new; end if;
    v_word := case new.request_status::text when 'approved' then 'approved' else 'rejected' end;
    v_note := left(regexp_replace(coalesce(new.review_note, ''), '\s+', ' ', 'g'), 140);
    select i.item_name, i.stock_ref, i.item_code, i.model_name into v_item, v_ref, v_code, v_model from inventory.products i where i.id = new.product_id;
    v_identifier := concat_ws(' · ', coalesce(nullif(btrim(v_ref), ''), 'Ref assigned on approval'), case when nullif(btrim(v_code), '') is not null then 'Code ' || btrim(v_code) end, case when nullif(btrim(v_model), '') is not null then 'Model ' || btrim(v_model) end);
    insert into public.notifications (recipient_id, sender_id, body, order_no)
    select p.id, v_sender,
      'Your ' || lower(left(regexp_replace(coalesce(new.request_type, 'stock'), '[^a-z]', '', 'g'), 10)) || ' request for '
        || left(regexp_replace(coalesce(v_item, 'an item'), '\s+', ' ', 'g'), 80) || E'\n' || v_identifier || ' was ' || v_word
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

commit;
