alter table public.product_templates
add column if not exists lifecycle_status text;

update public.product_templates
set lifecycle_status = case
  when is_active = true then 'active'
  else 'archived'
end
where lifecycle_status is null;

alter table public.product_templates
alter column lifecycle_status set default 'active';

update public.product_templates
set lifecycle_status = 'active'
where lifecycle_status not in ('active', 'archived', 'discontinued');

alter table public.product_templates
alter column lifecycle_status set not null;

alter table public.product_templates
drop constraint if exists product_templates_lifecycle_status_check;

alter table public.product_templates
add constraint product_templates_lifecycle_status_check
check (lifecycle_status in ('active', 'archived', 'discontinued'));
