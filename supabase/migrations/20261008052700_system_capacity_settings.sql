begin;

-- DBH-1C: owner-only, project-level capacity configuration.
-- Current metrics, snapshots and accounting functions are unchanged.
create table public.system_capacity_settings (
  id smallint primary key default 1 check (id = 1),
  database_capacity_bytes bigint check (database_capacity_bytes between 1 and 9007199254740991),
  storage_capacity_bytes bigint check (storage_capacity_bytes between 1 and 9007199254740991),
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null references public.profiles(id)
);

alter table public.system_capacity_settings enable row level security;
revoke all on table public.system_capacity_settings from public, anon, authenticated;
grant select, insert, update on table public.system_capacity_settings to service_role;

-- The table has no authenticated grants. These narrowly scoped entry points enforce
-- the existing active-System-Owner guard before reading or writing the single row.
create function public.system_capacity_settings_read() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare setting public.system_capacity_settings;
begin
  perform public.supplier_capacity_require_owner();
  select * into setting from public.system_capacity_settings where id = 1;
  return jsonb_build_object(
    'database_capacity_bytes', setting.database_capacity_bytes,
    'storage_capacity_bytes', setting.storage_capacity_bytes,
    'updated_at', setting.updated_at,
    'updated_by', setting.updated_by
  );
end $$;
revoke all on function public.system_capacity_settings_read() from public, anon, authenticated, service_role;
grant execute on function public.system_capacity_settings_read() to authenticated;

create function public.system_capacity_settings_save(
  p_database_capacity_bytes bigint,
  p_storage_capacity_bytes bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare setting public.system_capacity_settings;
begin
  perform public.supplier_capacity_require_owner();
  if p_database_capacity_bytes is not null and p_database_capacity_bytes not between 1 and 9007199254740991 then
    raise exception 'Database capacity must be positive and within the supported range.';
  end if;
  if p_storage_capacity_bytes is not null and p_storage_capacity_bytes not between 1 and 9007199254740991 then
    raise exception 'Storage capacity must be positive and within the supported range.';
  end if;

  insert into public.system_capacity_settings (
    id, database_capacity_bytes, storage_capacity_bytes, updated_at, updated_by
  ) values (
    1, p_database_capacity_bytes, p_storage_capacity_bytes, statement_timestamp(), auth.uid()
  )
  on conflict (id) do update set
    database_capacity_bytes = excluded.database_capacity_bytes,
    storage_capacity_bytes = excluded.storage_capacity_bytes,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
  returning * into setting;

  return jsonb_build_object(
    'database_capacity_bytes', setting.database_capacity_bytes,
    'storage_capacity_bytes', setting.storage_capacity_bytes,
    'updated_at', setting.updated_at,
    'updated_by', setting.updated_by
  );
end $$;
revoke all on function public.system_capacity_settings_save(bigint,bigint) from public, anon, authenticated, service_role;
grant execute on function public.system_capacity_settings_save(bigint,bigint) to authenticated;

commit;
