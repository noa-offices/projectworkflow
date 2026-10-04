begin;

-- Phase 2C: durable "confirmed_unchanged" Supplier review decision. Forward-only.
-- No backfill: existing 'reviewed' unchanged rows stay 'reviewed'. No Product/Brand writes.
alter table public.supplier_price_decisions drop constraint supplier_price_decisions_decision_check;
alter table public.supplier_price_decisions add constraint supplier_price_decisions_decision_check
  check (decision in ('reviewed','skip','reject','mapping_proposed','confirmed_unchanged'));

-- Patch only the decision branch of the deployed RPC (same approach as the finish-evidence migration),
-- preserving its owner, security definer, search_path, authorization and grants.
do $migration$
declare
  definition text;
  old_guard constant text := $old$if p_payload->>'decision'='reviewed' and match_record->>'classification' not in ('increased','decreased','changed','unchanged','shared') then raise exception 'Resolve the match before marking reviewed'; end if;$old$;
  new_guard constant text := old_guard || $new$
      if p_payload->>'decision'='confirmed_unchanged' then
        if not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
        if match_record->>'classification' is distinct from 'unchanged' then raise exception 'Only an unchanged match can be confirmed unchanged'; end if;
      end if;$new$;
  old_resolved constant text := $old$d.decision in ('reviewed','skip','reject')$old$;
  new_resolved constant text := $new$d.decision in ('reviewed','skip','reject','confirmed_unchanged')$new$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1
    or (length(definition)-length(replace(definition,old_resolved,'')))/length(old_resolved)<>1 then
    raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
  end if;
  execute replace(replace(definition,old_guard,new_guard),old_resolved,new_resolved);
end $migration$;

commit;
