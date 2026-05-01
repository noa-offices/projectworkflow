alter table public.quotations
add column if not exists layout_mode text not null default 'standard_proposal';

alter table public.quotation_sections
add column if not exists section_type text not null default 'section';

alter table public.quotation_items
add column if not exists room_name_snapshot text,
add column if not exists model_snapshot text,
add column if not exists finish_snapshot text,
add column if not exists size_snapshot text,
add column if not exists origin_snapshot text,
add column if not exists warranty_snapshot text,
add column if not exists supplier_name_snapshot text,
add column if not exists supplier_notes_snapshot text,
add column if not exists internal_cost numeric(14,2) not null default 0,
add column if not exists margin_value numeric(14,2) not null default 0,
add column if not exists margin_type text not null default 'amount',
add column if not exists is_rate_only boolean not null default false,
add column if not exists line_style text not null default 'normal';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotations_layout_mode_check'
      and conrelid = 'public.quotations'::regclass
  ) then
    alter table public.quotations
    add constraint quotations_layout_mode_check
    check (
      layout_mode in (
        'simple_proposal',
        'standard_proposal',
        'comparison',
        'boq_schedule',
        'internal_costing'
      )
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_sections_section_type_check'
      and conrelid = 'public.quotation_sections'::regclass
  ) then
    alter table public.quotation_sections
    add constraint quotation_sections_section_type_check
    check (section_type in ('option', 'floor', 'room', 'category', 'section'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_items_margin_type_check'
      and conrelid = 'public.quotation_items'::regclass
  ) then
    alter table public.quotation_items
    add constraint quotation_items_margin_type_check
    check (margin_type in ('amount', 'percent'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_items_line_style_check'
      and conrelid = 'public.quotation_items'::regclass
  ) then
    alter table public.quotation_items
    add constraint quotation_items_line_style_check
    check (line_style in ('normal', 'optional', 'rate_only', 'no_quote', 'note', 'heading'));
  end if;
end $$;

create index if not exists quotations_layout_mode_idx
on public.quotations (layout_mode);

create index if not exists quotation_sections_section_type_idx
on public.quotation_sections (section_type);

create index if not exists quotation_items_line_style_idx
on public.quotation_items (line_style);

create index if not exists quotation_items_room_name_snapshot_idx
on public.quotation_items (room_name_snapshot);

create index if not exists quotation_items_model_snapshot_idx
on public.quotation_items (model_snapshot);
