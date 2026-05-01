alter table public.quotations
add column if not exists overall_discount_type text not null default 'amount',
add column if not exists overall_discount_value numeric(14,2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotations_overall_discount_type_check'
      and conrelid = 'public.quotations'::regclass
  ) then
    alter table public.quotations
    add constraint quotations_overall_discount_type_check
    check (overall_discount_type in ('amount', 'percent'));
  end if;
end $$;

create index if not exists quotations_overall_discount_type_idx
on public.quotations (overall_discount_type);
