-- My Collection sharing (PR 4-1): send a COPY of a saved item to another active user. NOT applied automatically.
-- Rows in my_collection_shares are changed ONLY by the SECURITY DEFINER functions below (users get SELECT only).
-- A share is a snapshot built in SQL from the sender's OWN row; the client supplies only ids and a short note.
-- Pictures: the sender's server action may write ONE fixed file into the recipient's incoming folder while the share is pending.
-- Notifications reuse public.notifications (no new notification system).

-- A. Forbidden price-like keys anywhere in a JSON value (same key list as the app's recipe guard).
create or replace function public.my_collection_json_forbidden_key(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  with recursive walk(v) as (
    select p
    union all
    select c.value from walk w, lateral (
      select e.value from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) e
      union all
      select a.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) a
    ) c
  )
  select exists (
    select 1 from walk w, lateral jsonb_object_keys(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) k
    where lower(regexp_replace(k, '[^a-zA-Z0-9]', '', 'g')) = any (array[
      'price','prices','unitprice','netprice','total','totals','nettotal','exchangerate','exchangerates','internalcost',
      'suppliercost','cost','discount','discounttype','discountvalue','convertedquotationprice','sourceprice','defaultprice','finalprice'])
  );
$$;

-- B. Table.
create table if not exists public.my_collection_shares (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('setup', 'custom_item')),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null check (char_length(btrim(sender_name)) between 1 and 120),
  item_name text not null check (char_length(btrim(item_name)) between 1 and 120),
  note text check (note is null or char_length(note) <= 200),
  payload jsonb not null,
  source_id uuid,
  picture_path text,
  picture_note text check (picture_note is null or char_length(picture_note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed', 'unsent')),
  notification_id uuid references public.notifications(id) on delete set null,
  result_item_id uuid,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint shares_not_self check (sender_id <> recipient_id),
  constraint shares_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint shares_payload_size check (octet_length(payload::text) <= case when kind = 'setup' then 140000 else 12000 end),
  constraint shares_payload_no_paths check (not (payload ?| array['owner_id','image_path','picture_path','source_item_id','source_setup_id','shared_by','id'])),
  constraint shares_setup_payload check (kind <> 'setup' or (
    jsonb_typeof(payload->'recipe') = 'object' and jsonb_typeof(payload->'spec_overrides') = 'object'
    and payload->'recipe'->>'recipe_version' = '1'
    and (payload->'recipe'->>'template_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
  constraint shares_custom_payload check (kind <> 'custom_item' or (
    jsonb_typeof(payload->'selling_price') = 'number' and payload->>'currency' in ('AED','EUR','USD')
    and char_length(coalesce(payload->>'brand_name','')) between 1 and 80
    and char_length(coalesce(payload->>'item_name','')) between 1 and 120)),
  constraint shares_picture_path check (picture_path is null or picture_path = recipient_id::text || '/incoming/' || id::text || '/picture.webp'),
  constraint shares_status_time check ((status = 'pending') = (responded_at is null)),
  constraint shares_result_only_accepted check (result_item_id is null or status = 'accepted')
);

create index if not exists my_collection_shares_recipient_pending_idx on public.my_collection_shares (recipient_id, created_at desc) where status = 'pending';
create index if not exists my_collection_shares_recipient_idx on public.my_collection_shares (recipient_id, created_at desc);
create index if not exists my_collection_shares_sender_idx on public.my_collection_shares (sender_id, created_at desc);
create unique index if not exists my_collection_shares_one_pending_idx on public.my_collection_shares (sender_id, recipient_id, source_id) where status = 'pending' and source_id is not null;

alter table public.my_collection_shares enable row level security;

drop policy if exists shares_select_recipient on public.my_collection_shares;
create policy shares_select_recipient on public.my_collection_shares for select to authenticated
  using (recipient_id = (select auth.uid()) and (select public.current_user_is_active()));
drop policy if exists shares_select_sender on public.my_collection_shares;
create policy shares_select_sender on public.my_collection_shares for select to authenticated
  using (sender_id = (select auth.uid()) and (select public.current_user_is_active()));

revoke all on public.my_collection_shares from public, anon, authenticated;
grant select on public.my_collection_shares to authenticated;   -- no insert/update/delete: only the functions below change rows

-- C. Who can be chosen as a recipient: display name only (no email), searchable, 20 rows.
create or replace function public.my_collection_share_targets(p_query text)
returns table (id uuid, display_name text) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.current_user_is_active() or char_length(btrim(coalesce(p_query, ''))) < 2 then return; end if;
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), 'Unnamed user')
    from public.profiles p
    where p.id <> auth.uid() and p.account_status::text = 'active'
      and p.role::text in ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer')
      and p.full_name ilike '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%'
    order by 2 limit 20;
end $$;

-- D. Send: the snapshot is built from the sender's OWN row.
create or replace function public.my_collection_send_share(p_kind text, p_item_id uuid, p_recipient_id uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid(); v_name text; v_item_name text; v_payload jsonb;
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

  insert into public.my_collection_shares (id, kind, sender_id, recipient_id, sender_name, item_name, note, payload, source_id)
  values (v_id, p_kind, v_me, p_recipient_id, v_name, v_item_name, nullif(btrim(p_note), ''), v_payload, p_item_id);

  begin  -- a notification problem never blocks the share
    insert into public.notifications (recipient_id, sender_id, body, order_no)
    values (p_recipient_id, v_me, left(v_name, 60) || ' shared ' || left(v_item_name, 80) || ' with you', '/products/my-collection?tab=shared')
    returning id into v_nid;
    update public.my_collection_shares set notification_id = v_nid where id = v_id;
  exception when others then null;
  end;
  return v_id;
end $$;

-- E. Picture: the path is computed here, never taken from the client. The file must really exist.
create or replace function public.my_collection_attach_share_picture(p_share_id uuid, p_ok boolean, p_note text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_path text; v_ok boolean;
begin
  select recipient_id::text || '/incoming/' || id::text || '/picture.webp' into v_path
    from public.my_collection_shares where id = p_share_id and sender_id = auth.uid() and status = 'pending';
  if v_path is null then return false; end if;
  v_ok := coalesce(p_ok, false) and exists (select 1 from storage.objects o where o.bucket_id = 'my-collection-images' and o.name = v_path);
  update public.my_collection_shares
     set picture_path = case when v_ok then v_path end,
         picture_note = case when v_ok then null else left(coalesce(nullif(btrim(p_note), ''), 'The sender''s picture could not be included.'), 200) end
   where id = p_share_id;
  return v_ok;
end $$;

-- F. Unsend (sender) and Dismiss (recipient).
create or replace function public.my_collection_unsend_share(p_share_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n uuid;
begin
  update public.my_collection_shares set status = 'unsent', responded_at = now()
   where id = p_share_id and sender_id = auth.uid() and status = 'pending' returning notification_id into v_n;
  if not found then return false; end if;
  delete from public.notifications where id = v_n;
  return true;
end $$;

create or replace function public.my_collection_dismiss_share(p_share_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n uuid;
begin
  update public.my_collection_shares set status = 'dismissed', responded_at = now()
   where id = p_share_id and recipient_id = auth.uid() and status = 'pending' returning notification_id into v_n;
  if not found then return false; end if;
  update public.notifications set read_at = coalesce(read_at, now()) where id = v_n and recipient_id = auth.uid();
  return true;
end $$;

-- G. Accept a custom item (scalar arguments only; the owner is the caller; provenance is set here).
create or replace function public.my_collection_accept_custom_item(p_share_id uuid, p_brand text, p_name text, p_code text, p_spec text,
  p_unit text, p_price numeric, p_currency text, p_image_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); s public.my_collection_shares%rowtype; v_new uuid := gen_random_uuid(); v_src uuid;
begin
  if v_me is null or not public.current_user_is_active() then raise exception 'Not allowed.'; end if;
  select * into s from public.my_collection_shares where id = p_share_id and recipient_id = v_me and kind = 'custom_item' for update;
  if not found then raise exception 'Share not found.'; end if;
  if s.status = 'accepted' then return s.result_item_id; end if;           -- idempotent
  if s.status <> 'pending' then raise exception 'This share is no longer available.'; end if;
  if p_image_path is not null and p_image_path not like v_me::text || '/%' then raise exception 'Invalid picture.'; end if;
  select id into v_src from public.saved_custom_items where id = s.source_id;
  insert into public.saved_custom_items (id, owner_id, brand_name, item_name, item_code, specification, unit_label, selling_price, currency, image_path, source_item_id, shared_by)
  values (v_new, v_me, btrim(p_brand), btrim(p_name), nullif(btrim(p_code), ''), nullif(btrim(p_spec), ''), btrim(p_unit), p_price, p_currency, p_image_path, v_src, s.sender_id);
  update public.my_collection_shares set status = 'accepted', responded_at = now(), result_item_id = v_new where id = s.id;
  update public.notifications set read_at = coalesce(read_at, now()) where id = s.notification_id and recipient_id = v_me;
  begin  -- quiet "accepted" notification to the sender
    insert into public.notifications (recipient_id, sender_id, body, order_no)
    select s.sender_id, v_me, left(coalesce(nullif(btrim(p.full_name), ''), 'A colleague'), 60) || ' added ' || left(s.item_name, 80) || ' to their collection', '/products/my-collection?tab=sent'
      from public.profiles p, public.profiles snd where p.id = v_me and snd.id = s.sender_id and snd.account_status::text = 'active';
  exception when others then null;
  end;
  return v_new;
end $$;

-- H. Accept a setup: recipe and overrides come from the share; brand/product come from the template; only name and note are editable.
create or replace function public.my_collection_accept_setup(p_share_id uuid, p_setup_name text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); s public.my_collection_shares%rowtype; t record; v_brand text; v_new uuid := gen_random_uuid(); v_src uuid;
begin
  if v_me is null or not public.current_user_is_active() then raise exception 'Not allowed.'; end if;
  select * into s from public.my_collection_shares where id = p_share_id and recipient_id = v_me and kind = 'setup' for update;
  if not found then raise exception 'Share not found.'; end if;
  if s.status = 'accepted' then return s.result_item_id; end if;
  if s.status <> 'pending' then raise exception 'This share is no longer available.'; end if;
  select * into t from public.product_templates where id = (s.payload->'recipe'->>'template_id')::uuid;
  if not found or t.is_active is not true or t.lifecycle_status is distinct from 'active' then
    raise exception 'This product is not available to you.';
  end if;
  select b.name into v_brand from public.brands b where b.id = t.brand_id;
  select id into v_src from public.saved_setups where id = s.source_id;
  insert into public.saved_setups (id, owner_id, template_id, brand_id, brand_name, product_name, setup_name, note, recipe, recipe_version,
                                   spec_overrides, template_pricing_version_at_save, source_setup_id, shared_by)
  values (v_new, v_me, t.id, t.brand_id, coalesce(nullif(btrim(v_brand), ''), 'Other'), coalesce(nullif(btrim(t.template_name), ''), 'Product'),
          btrim(p_setup_name), nullif(left(btrim(coalesce(p_note, '')), 500), ''), s.payload->'recipe', 1, s.payload->'spec_overrides', t.pricing_version, v_src, s.sender_id);
  update public.my_collection_shares set status = 'accepted', responded_at = now(), result_item_id = v_new where id = s.id;
  update public.notifications set read_at = coalesce(read_at, now()) where id = s.notification_id and recipient_id = v_me;
  begin  -- quiet "accepted" notification to the sender
    insert into public.notifications (recipient_id, sender_id, body, order_no)
    select s.sender_id, v_me, left(coalesce(nullif(btrim(p.full_name), ''), 'A colleague'), 60) || ' added ' || left(s.item_name, 80) || ' to their collection', '/products/my-collection?tab=sent'
      from public.profiles p, public.profiles snd where p.id = v_me and snd.id = s.sender_id and snd.account_status::text = 'active';
  exception when others then null;
  end;
  return v_new;
end $$;

-- I. Lazy cleanup (no cron in this project): finished shares older than 30 days that involve the caller.
-- Returns the picture paths so the caller's own session can delete the incoming files.
create or replace function public.my_collection_purge_finished_shares()
returns table (picture_path text) language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  return query
    delete from public.my_collection_shares s
     where s.status <> 'pending' and s.responded_at < now() - interval '30 days'
       and (s.recipient_id = auth.uid() or s.sender_id = auth.uid())
    returning s.picture_path;
end $$;

-- J. Execute rights: signed-in users only, never anon.
revoke all on function public.my_collection_json_forbidden_key(jsonb), public.my_collection_share_targets(text),
  public.my_collection_send_share(text,uuid,uuid,text), public.my_collection_attach_share_picture(uuid,boolean,text),
  public.my_collection_unsend_share(uuid), public.my_collection_dismiss_share(uuid),
  public.my_collection_accept_custom_item(uuid,text,text,text,text,text,numeric,text,text),
  public.my_collection_accept_setup(uuid,text,text), public.my_collection_purge_finished_shares()
  from public, anon;
grant execute on function public.my_collection_share_targets(text), public.my_collection_send_share(text,uuid,uuid,text),
  public.my_collection_attach_share_picture(uuid,boolean,text), public.my_collection_unsend_share(uuid),
  public.my_collection_dismiss_share(uuid), public.my_collection_accept_custom_item(uuid,text,text,text,text,text,numeric,text,text),
  public.my_collection_accept_setup(uuid,text,text), public.my_collection_purge_finished_shares()
  to authenticated;

-- K. Storage: the sender may write ONE fixed file into the recipient's incoming folder while the share is pending, and delete it later.
drop policy if exists my_collection_images_insert_share_incoming on storage.objects;
create policy my_collection_images_insert_share_incoming on storage.objects for insert to authenticated
with check (
  bucket_id = 'my-collection-images' and (storage.foldername(name))[2] = 'incoming'
  and array_length(storage.foldername(name), 1) = 3 and storage.filename(name) = 'picture.webp'
  and (select public.current_user_is_active())
  and exists (select 1 from public.my_collection_shares s
              where s.id::text = (storage.foldername(name))[3] and s.recipient_id::text = (storage.foldername(name))[1]
                and s.sender_id = (select auth.uid()) and s.status = 'pending'));

drop policy if exists my_collection_images_delete_share_incoming on storage.objects;
create policy my_collection_images_delete_share_incoming on storage.objects for delete to authenticated
using (
  bucket_id = 'my-collection-images' and (storage.foldername(name))[2] = 'incoming' and array_length(storage.foldername(name), 1) = 3
  and exists (select 1 from public.my_collection_shares s
              where s.id::text = (storage.foldername(name))[3] and s.recipient_id::text = (storage.foldername(name))[1] and s.sender_id = (select auth.uid())));
