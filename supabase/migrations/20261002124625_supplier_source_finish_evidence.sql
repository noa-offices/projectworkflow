begin;

-- Forward-only correction: retain physical finish evidence on identities built
-- by FUTURE finalizations. Do not backfill/rewrite any imported source snapshot.
-- Patch only the known JSON projection, preserving the deployed RPC's remaining
-- body, ownership, authorization, search_path, grants and completeness checks.
do $migration$
declare
  definition text;
  old_projection constant text := $old$'finishes',case when varied and finish_driven then to_jsonb(finishes) else '[]'::jsonb end$old$;
  new_projection constant text := $new$'finishes',coalesce(to_jsonb(array_remove(finishes,'')),'[]'::jsonb)$new$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure)
    into definition;
  if strpos(definition,old_projection)>0 then
    if (length(definition)-length(replace(definition,old_projection,'')))/length(old_projection)<>1 then
      raise exception 'Expected exactly one supplier finish projection; review deployed RPC before migrating';
    end if;
    execute replace(definition,old_projection,new_projection);
  elsif strpos(definition,new_projection)=0 then
    raise exception 'Supplier finish projection differs from the expected Phase 1b RPC; review before migrating';
  end if;
end $migration$;

commit;
