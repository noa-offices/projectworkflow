begin;

-- Supplier import, chunk write: set-based insert instead of one INSERT per row and per cell.
-- Patches only the `chunk` branch of the deployed supplier_price_review_write. Everything else is untouched: ownership/RLS checks, the
-- source row lock, chunk range and size validation, the idempotent receipt (same payload => reused, changed payload => error),
-- the counters and state transition, the retained-column rule (supplier_retained_values) and the cell-provenance error text.
--  * Rows are inserted first (as before), then every cell must belong to a row of this chunk (same error), then the cells are inserted.
--    A duplicate key or constraint failure still aborts the whole chunk transaction, exactly as the per-row loops did.
--  * Values are the same expressions the loops used, in payload order. The old loops stay in the function body but select no rows
--    (`where false`), so the patch only needs single-line anchors and cannot disturb surrounding text.
--  * Fail-closed: if the deployed body does not contain each anchor exactly once, the migration aborts and changes nothing.
-- Forward-only. Not measured against a live database when written; verify with a small import after applying (see the PR notes).
do $migration$
declare
  definition text;
  anchor_rows_loop constant text := $a$for r in select value from jsonb_array_elements(p_payload->'rows') loop$a$;
  anchor_cells_loop constant text := $a$for c in select value from jsonb_array_elements(p_payload->'cells') loop$a$;
  anchor_retained constant text := $a$public.supplier_retained_values(s.profile,r->'values')$a$;
  anchor_receipt constant text := $a$insert into public.supplier_source_chunks values(s.id,chunk,p_payload);$a$;
  bulk constant text := $b$-- Set-based chunk insert (20261016120000): same values as the former per-row loops.
      insert into public.supplier_source_rows(source_id,unit_key,row_number,sheet,raw_extras,page_reference)
        select s.id,rv->>'unit_key',(rv->>'row_number')::int,rv->>'sheet',public.supplier_retained_values(s.profile,rv->'values'),rv->>'page_reference'
        from jsonb_array_elements(p_payload->'rows') with ordinality as t(rv,ord) order by ord;
      if exists(select 1 from jsonb_array_elements(p_payload->'cells') cv
        where not coalesce((cv->>'row_key') = any(array(select xv->>'unit_key' from jsonb_array_elements(p_payload->'rows') xv)), false)) then
        raise exception 'Cell provenance is outside this chunk';
      end if;
      insert into public.supplier_source_cells
        select s.id,cv->>'unit_key',cv->>'row_key',cv->>'code',cv->>'raw_code',cv->>'raw_article',cv->>'finish',cv->>'dimension',cv->>'price_field',(cv->>'price')::numeric,cv->'raw_price',array(select jsonb_array_elements_text(cv->'issues')),coalesce(cv->>'companion_note','')
        from jsonb_array_elements(p_payload->'cells') with ordinality as t(cv,ord) order by ord;
      $b$;
  anchor text;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  foreach anchor in array array[anchor_rows_loop, anchor_cells_loop, anchor_retained, anchor_receipt] loop
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
      raise exception 'Deployed supplier review RPC differs from the expected chunk body (%); review before migrating', left(anchor, 60);
    end if;
  end loop;
  execute replace(replace(replace(definition,
    anchor_rows_loop, 'for r in select value from jsonb_array_elements(p_payload->''rows'') where false loop'),
    anchor_cells_loop, 'for c in select value from jsonb_array_elements(p_payload->''cells'') where false loop'),
    anchor_receipt, bulk || anchor_receipt);
end $migration$;

commit;
