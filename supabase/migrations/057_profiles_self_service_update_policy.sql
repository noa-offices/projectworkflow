create or replace function public.prevent_self_profile_privileged_field_changes()
returns trigger
language plpgsql
as $$
begin
  if old.id = auth.uid() and old.role <> 'system_owner' then
    if (to_jsonb(new) - array['updated_at', 'full_name', 'phone', 'job_title', 'department'])
      is distinct from
      (to_jsonb(old) - array['updated_at', 'full_name', 'phone', 'job_title', 'department']) then
      raise exception 'You can only update your own profile details.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_self_privileged_updates on public.profiles;

create trigger profiles_prevent_self_privileged_updates
before update on public.profiles
for each row
execute function public.prevent_self_profile_privileged_field_changes();

drop policy if exists profiles_update_own on public.profiles;

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());
