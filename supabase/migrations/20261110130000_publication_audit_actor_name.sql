-- "Quotation saved to software" audit rows now carry the signed-in user's name (metadata.actorName).
-- Name comes from public.profiles.full_name for the authenticated user. A blank name writes no actorName.
-- A client-supplied actorName in p_metadata is removed. Same signature and permissions as before.
create or replace function local_builder_private.finish_publication(p_id uuid, p_mutation uuid, p_base uuid, p_hash text, p_result jsonb, p_metadata jsonb)
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  actor uuid := local_builder_private.check_publisher();
  actor_name text := (select nullif(btrim(full_name), '') from public.profiles where id = actor);
begin
  if not exists (select 1 from public.quotations where id = p_id and workspace_version::text = p_result->>'version')
  then raise exception 'Publication version mismatch'; end if;
  insert into local_builder_private.publication_receipts values (actor, p_id, p_mutation, p_base, p_hash, p_result);
  insert into public.audit_activity_log(entity_type,entity_id,action,title,description,metadata,created_by)
    select 'quotation',id,'quotation_software_snapshot_saved','Quotation saved to software',quotation_no,
      (coalesce(p_metadata, '{}'::jsonb) - 'actorName')
        || case when actor_name is null then '{}'::jsonb else jsonb_build_object('actorName', actor_name) end,
      actor
    from public.quotations where id = p_id;
end;
$fn$;
