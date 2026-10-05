-- supplier_source_cells(source_id,row_key) references supplier_source_rows(source_id,unit_key), but no index covered the child columns.
-- Every deleted source row therefore made PostgreSQL scan supplier_source_cells for referencing cells, which timed out the
-- approved duplicate-source cleanup. This index lets the FK check use an index lookup. No other change.
create index if not exists supplier_source_cells_row_key on public.supplier_source_cells(source_id, row_key);
