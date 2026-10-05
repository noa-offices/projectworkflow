begin;

-- Phase 2I-1: reusable Supplier Source Definitions with durable Family coverage.
-- Additive and forward-only. No backfill: a source with no definition and a batch with no coverage snapshot keep today's behavior.
-- Read access only (same reviewer policy as the other Supplier workflow tables); the write path arrives with a later phase.

create table public.supplier_source_definitions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  name text not null check (btrim(name) <> ''),
  profile_id uuid references public.supplier_price_profiles(id),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (brand_id, name),
  unique (id, brand_id)
);

-- One row per Family (Product Template) a definition is responsible for.
-- Deliberately no unique(template_id): overlaps between definitions must stay representable so they can be flagged.
create table public.supplier_source_definition_families (
  definition_id uuid not null references public.supplier_source_definitions(id),
  template_id uuid not null references public.product_templates(id),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  primary key (definition_id, template_id)
);
create index supplier_source_definition_families_template on public.supplier_source_definition_families(template_id);

-- Coverage must never cross Brands: the profile and every covered Family belong to the definition's Brand.
create function public.supplier_source_definition_integrity() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.profile_id is not null and not exists (select 1 from public.supplier_price_profiles p where p.id = new.profile_id and p.brand_id = new.brand_id) then
    raise exception 'Import profile belongs to another Brand';
  end if;
  return new;
end $$;
create trigger supplier_source_definition_integrity before insert or update on public.supplier_source_definitions
  for each row execute function public.supplier_source_definition_integrity();

create function public.supplier_source_definition_family_integrity() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.supplier_source_definitions d join public.product_templates t on t.brand_id = d.brand_id where d.id = new.definition_id and t.id = new.template_id) then
    raise exception 'Family belongs to another Brand';
  end if;
  return new;
end $$;
create trigger supplier_source_definition_family_integrity before insert or update on public.supplier_source_definition_families
  for each row execute function public.supplier_source_definition_family_integrity();

-- Nullable on purpose: NULL means a legacy source / unrestricted batch.
alter table public.supplier_source_versions add column definition_id uuid;
alter table public.supplier_source_versions add constraint supplier_source_versions_definition_fk
  foreign key (definition_id, brand_id) references public.supplier_source_definitions(id, brand_id);
alter table public.supplier_price_batches add column coverage_template_ids uuid[];

do $$ declare table_name text; begin
  foreach table_name in array array['supplier_source_definitions', 'supplier_source_definition_families'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('create policy reviewer_read on public.%I for select to authenticated using (public.current_user_can_review_brand_prices())', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end $$;

commit;
