-- My Collection sharing (PR 4-2b): remember the recipient's display NAME on the share so the sender's "Sent" list can show it
-- (a sender cannot read other users' profiles). Small, safe change: one nullable column + the send function now fills it. NOT applied automatically.
alter table public.my_collection_shares add column if not exists recipient_name text;
alter table public.my_collection_shares drop constraint if exists shares_recipient_name_len;
alter table public.my_collection_shares add constraint shares_recipient_name_len check (recipient_name is null or char_length(recipient_name) <= 120);

create or replace function public.my_collection_send_share(p_kind text, p_item_id uuid, p_recipient_id uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid(); v_name text; v_rname text; v_item_name text; v_payload jsonb;
  v_id uuid := gen_random_uuid(); v_nid uuid; v_active boolean; v_lifecycle text;
begin
  if v_me is null or not public.current_user_is_active() then raise exception 'Not allowed.'; end if;
  if p_recipient_id = v_me then raise exception 'You cannot share with yourself.'; end if;
  if p_kind not in ('setup', 'custom_item') then raise exception 'Unknown item type.'; end if;
  if char_length(coalesce(p_note, '')) > 200 then raise exception 'The note is too long.'; end if;
  if not exists (select 1 from public.profiles r where r.id = p_recipient_id and r.account_status::text = 'active'
      and r.role::text in ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer')) then
    raise exception 'This user cannot receive shares.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_recipient_id::text, 0));
  if (select count(*) from public.my_collection_shares where recipient_id = p_recipient_id and status = 'pending') >= 50
     or (select count(*) from public.my_collection_shares where sender_id = v_me and recipient_id = p_recipient_id and status = 'pending') >= 10
     or (select count(*) from public.my_collection_shares where sender_id = v_me and status = 'pending') >= 50
     or (select count(*) from public.my_collection_shares where sender_id = v_me and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many shares are waiting. Try again later.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'A colleague') into v_name from public.profiles where id = v_me;
  select coalesce(nullif(btrim(full_name), ''), 'Unnamed user') into v_rname from public.profiles where id = p_recipient_id;

  if p_kind = 'setup' then
    select s.setup_name, jsonb_build_object('recipe', s.recipe, 'spec_overrides', s.spec_overrides, 'setup_name', s.setup_name,
             'note', s.note, 'brand_name', s.brand_name, 'product_name', s.product_name)
      into v_item_name, v_payload
      from public.saved_setups s where s.id = p_item_id and s.owner_id = v_me and not s.archived;
    if v_payload is null then raise exception 'Item not found.'; end if;
    if public.my_collection_json_forbidden_key(v_payload->'recipe') or public.my_collection_json_forbidden_key(v_payload->'spec_overrides') then
      raise exception 'A setup with prices cannot be shared.';
    end if;
    select t.is_active, t.lifecycle_status into v_active, v_lifecycle
      from public.product_templates t where t.id = ((v_payload->'recipe'->>'template_id')::uuid);
    if not found or v_active is not true or v_lifecycle is distinct from 'active' then
      raise exception 'This product is not available to the recipient.';
    end if;
  else
    select c.item_name, jsonb_build_object('brand_name', c.brand_name, 'item_name', c.item_name, 'item_code', c.item_code,
             'specification', c.specification, 'unit_label', c.unit_label, 'selling_price', c.selling_price, 'currency', c.currency)
      into v_item_name, v_payload
      from public.saved_custom_items c where c.id = p_item_id and c.owner_id = v_me;
    if v_payload is null then raise exception 'Item not found.'; end if;
  end if;

  insert into public.my_collection_shares (id, kind, sender_id, recipient_id, sender_name, recipient_name, item_name, note, payload, source_id)
  values (v_id, p_kind, v_me, p_recipient_id, v_name, v_rname, v_item_name, nullif(btrim(p_note), ''), v_payload, p_item_id);

  begin  -- a notification problem never blocks the share
    insert into public.notifications (recipient_id, sender_id, body, order_no)
    values (p_recipient_id, v_me, left(v_name, 60) || ' shared ' || left(v_item_name, 80) || ' with you', '/products/my-collection?tab=shared')
    returning id into v_nid;
    update public.my_collection_shares set notification_id = v_nid where id = v_id;
  exception when others then null;
  end;
  return v_id;
end $$;
