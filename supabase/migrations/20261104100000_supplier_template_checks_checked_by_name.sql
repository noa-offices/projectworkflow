begin;

-- Show who did a per-product price check. supplier_template_checks already stores checked_by; the read function did not return it.
-- This adds ONE key to each element of supplier_template_checks_latest(uuid[]): checked_by_name = profiles.full_name, trimmed,
-- null when it is empty or the profile is gone. It never returns the email, the role or the user id.
-- The signature, role check, SECURITY DEFINER, search_path and grants stay exactly as they are (the function is patched in place,
-- so its privileges are kept). Nothing else changes: not the table, not RLS, not the write operation.
-- Forward-only. It refuses to run when the deployed function is not the expected one, or was already patched.

do $migration$
declare
  definition text;
  old_keys constant text := $old$'line_count', x.line_count, 'checked_at', x.checked_at) order by x.source_id, x.template_id)$old$;
  new_keys constant text := $new$'line_count', x.line_count, 'checked_at', x.checked_at, 'checked_by_name', x.checked_by_name) order by x.source_id, x.template_id)$new$;
  old_select constant text := $old$select distinct on (c.source_id, c.template_id) c.source_id, c.template_id, c.definition_id, c.pricing_version, c.line_count, c.checked_at$old$;
  new_select constant text := $new$select distinct on (c.source_id, c.template_id) c.source_id, c.template_id, c.definition_id, c.pricing_version, c.line_count, c.checked_at, (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = c.checked_by) as checked_by_name$new$;
  anchor text;
begin
  select pg_get_functiondef(to_regprocedure('public.supplier_template_checks_latest(uuid[])')) into definition;
  if definition is null then raise exception 'supplier_template_checks_latest(uuid[]) not found; apply the template checks migration first'; end if;
  if position('checked_by_name' in definition) > 0 then raise exception 'supplier_template_checks_latest is already patched'; end if;
  foreach anchor in array array[old_keys, old_select] loop
    if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'Deployed supplier_template_checks_latest differs from the expected body; review before migrating';
    end if;
  end loop;
  execute replace(replace(definition, old_keys, new_keys), old_select, new_select);
end $migration$;

commit;
