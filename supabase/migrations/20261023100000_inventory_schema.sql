-- Final inventory structure derived from source SQL 001-008.
-- Uses the existing public profiles, brands, roles and active-account helpers.
create schema if not exists inventory;
revoke all on schema inventory from public, anon;

do $$
begin
  create type inventory.product_status as enum (
    'available',
    'reserved',
    'showroom',
    'missing',
    'sold',
    'hold'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type inventory.product_condition as enum ('new', 'used', 'showroom', 'damaged');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type inventory.product_source as enum (
    'project_balance',
    'purchase',
    'sample',
    'manual_entry'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type inventory.product_request_status as enum (
    'pending_review',
    'approved',
    'rejected'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type inventory.inventory_movement_type as enum (
    'stock_in',
    'stock_out',
    'transfer',
    'adjustment'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type inventory.dimension_unit as enum ('mm', 'cm', 'm');
exception when duplicate_object then null;
end $$;

create or replace function inventory.set_updated_at()
returns trigger language plpgsql set search_path = inventory as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke execute on function inventory.set_updated_at() from public, anon;

create or replace function inventory.can_view()
returns boolean language sql stable security definer set search_path = inventory, public
as $$
  select coalesce(public.current_user_can_access_inventory(), false);
$$;
revoke execute on function inventory.can_view() from public, anon;
grant execute on function inventory.can_view() to authenticated, service_role;

create or replace function inventory.can_manage()
returns boolean language sql stable security definer set search_path = inventory, public
as $$
  select coalesce(public.current_account_status() = 'active' and public.current_user_role() in ('system_owner', 'admin_manager'), false);
$$;
revoke execute on function inventory.can_manage() from public, anon;
grant execute on function inventory.can_manage() to authenticated, service_role;

create or replace function inventory.can_request_hold_book()
returns boolean language sql stable security definer set search_path = inventory, public
as $$
  select coalesce(public.current_account_status() = 'active' and public.current_user_role() in ('procurement_manager', 'sales_designer', 'sales_coordinator', 'designer'), false);
$$;
revoke execute on function inventory.can_request_hold_book() from public, anon;
grant execute on function inventory.can_request_hold_book() to authenticated, service_role;

create or replace function inventory.can_request_add_take()
returns boolean language sql stable security definer set search_path = inventory, public
as $$
  select coalesce(public.current_account_status() = 'active' and public.current_user_role() = 'warehouse_staff', false);
$$;
revoke execute on function inventory.can_request_add_take() from public, anon;
grant execute on function inventory.can_request_add_take() to authenticated, service_role;

create table if not exists inventory.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references inventory.categories(id) on delete restrict,
  name text not null,
  slug text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(trim(name)) > 0),
  constraint categories_slug_not_blank check (length(trim(slug)) > 0)
);

create table if not exists inventory.products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete restrict,
  category_id uuid not null references inventory.categories(id) on delete restrict,
  subcategory_id uuid references inventory.categories(id) on delete restrict,
  custom_category_name text,
  stock_ref text not null,
  item_code text not null,
  item_name text not null,
  model_name text not null,
  description text,
  quantity integer not null default 0,
  warehouse_quantity integer not null default 0,
  dubai_showroom_quantity integer not null default 0,
  abudhabi_showroom_quantity integer not null default 0,
  mockup_quantity integer not null default 0,
  temporary_out_quantity integer not null default 0,
  sold_quantity integer not null default 0,
  low_stock_at integer not null default 0,
  status inventory.product_status not null default 'available',
  condition inventory.product_condition not null default 'new',
  source inventory.product_source not null default 'manual_entry',
  location text,
  note text,
  dimension_length numeric(12, 2),
  dimension_width numeric(12, 2),
  dimension_height numeric(12, 2),
  dimension_unit inventory.dimension_unit,
  price numeric(12, 2) not null default 0,
  freight_cost numeric(12, 2) not null default 0,
  c_and_f numeric(12, 2) not null default 0,
  transport numeric(12, 2) not null default 0,
  custom_duty numeric(12, 2) not null default 0,
  labour numeric(12, 2) not null default 0,
  vat numeric(12, 2) not null default 0,
  total_cost numeric(12, 2) generated always as (
    price + freight_cost + c_and_f + transport + custom_duty + labour + vat
  ) stored,
  is_active boolean not null default true,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  removal_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  item_type text not null default 'product',
  constraint products_item_type_allowed check (item_type in ('product', 'accessory', 'temporary')),
  constraint products_stock_ref_not_blank check (length(trim(stock_ref)) > 0),
  constraint products_item_code_not_blank check (length(trim(item_code)) > 0),
  constraint products_item_name_not_blank check (length(trim(item_name)) > 0),
  constraint products_model_name_not_blank check (length(trim(model_name)) > 0),
  constraint products_quantity_not_negative check (quantity >= 0),
  constraint products_stock_buckets_not_negative check (
    warehouse_quantity >= 0
    and dubai_showroom_quantity >= 0
    and abudhabi_showroom_quantity >= 0
    and mockup_quantity >= 0
    and temporary_out_quantity >= 0
    and sold_quantity >= 0
  ),
  constraint products_quantity_matches_live_buckets check (
    quantity = warehouse_quantity + dubai_showroom_quantity + abudhabi_showroom_quantity + mockup_quantity + temporary_out_quantity
  ),
  constraint products_low_stock_not_negative check (low_stock_at >= 0),
  constraint products_costs_not_negative check (
    price >= 0
    and freight_cost >= 0
    and c_and_f >= 0
    and transport >= 0
    and custom_duty >= 0
    and labour >= 0
    and vat >= 0
  ),
  constraint products_dimensions_complete check (
    (
      dimension_length is null
      and dimension_width is null
      and dimension_height is null
      and dimension_unit is null
    )
    or (
      dimension_length > 0
      and dimension_width > 0
      and dimension_height > 0
      and dimension_unit is not null
    )
  )
);

create table if not exists inventory.product_requests (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete restrict,
  category_id uuid not null references inventory.categories(id) on delete restrict,
  subcategory_id uuid references inventory.categories(id) on delete restrict,
  custom_category_name text,
  stock_ref text not null,
  item_code text not null,
  item_name text not null,
  model_name text not null,
  description text,
  quantity integer not null,
  requested_status inventory.product_status not null default 'available',
  condition inventory.product_condition not null default 'new',
  source inventory.product_source not null default 'manual_entry',
  note text,
  dimension_length numeric(12, 2),
  dimension_width numeric(12, 2),
  dimension_height numeric(12, 2),
  dimension_unit inventory.dimension_unit,
  price numeric(12, 2) not null default 0,
  freight_cost numeric(12, 2) not null default 0,
  c_and_f numeric(12, 2) not null default 0,
  transport numeric(12, 2) not null default 0,
  custom_duty numeric(12, 2) not null default 0,
  labour numeric(12, 2) not null default 0,
  vat numeric(12, 2) not null default 0,
  total_cost numeric(12, 2) generated always as (
    price + freight_cost + c_and_f + transport + custom_duty + labour + vat
  ) stored,
  request_status inventory.product_request_status not null default 'pending_review',
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  approved_product_id uuid references inventory.products(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  item_type text not null default 'product',
  constraint product_requests_item_type_allowed check (item_type in ('product', 'accessory', 'temporary')),
  constraint product_requests_stock_ref_not_blank check (length(trim(stock_ref)) > 0),
  constraint product_requests_item_code_not_blank check (length(trim(item_code)) > 0),
  constraint product_requests_item_name_not_blank check (length(trim(item_name)) > 0),
  constraint product_requests_model_name_not_blank check (length(trim(model_name)) > 0),
  constraint product_requests_quantity_positive check (quantity > 0),
  constraint product_requests_costs_not_negative check (
    price >= 0
    and freight_cost >= 0
    and c_and_f >= 0
    and transport >= 0
    and custom_duty >= 0
    and labour >= 0
    and vat >= 0
  ),
  constraint product_requests_dimensions_complete check (
    (
      dimension_length is null
      and dimension_width is null
      and dimension_height is null
      and dimension_unit is null
    )
    or (
      dimension_length > 0
      and dimension_width > 0
      and dimension_height > 0
      and dimension_unit is not null
    )
  )
);

create table if not exists inventory.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references inventory.products(id) on delete cascade,
  product_request_id uuid references inventory.product_requests(id) on delete cascade,
  storage_bucket text not null default 'inventory-images',
  storage_path text not null,
  public_url text,
  file_name text,
  content_type text,
  size_bytes integer,
  sort_order smallint not null default 0,
  is_main boolean not null default false,
  alt_text text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_images_one_owner check (
    (
      product_id is not null
      and product_request_id is null
    )
    or (
      product_id is null
      and product_request_id is not null
    )
  ),
  constraint product_images_max_three_order check (sort_order between 0 and 2),
  constraint product_images_main_is_first check (not is_main or sort_order = 0),
  constraint product_images_storage_path_not_blank check (length(trim(storage_path)) > 0),
  constraint product_images_size_not_negative check (size_bytes is null or size_bytes >= 0)
);

create table if not exists inventory.movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references inventory.products(id) on delete restrict,
  movement_type inventory.inventory_movement_type not null,
  action_type text not null default 'internal_transfer',
  from_location text,
  to_location text,
  quantity integer not null,
  previous_quantity integer not null,
  new_quantity integer not null,
  note text,
  reference_type text not null default 'manual',
  reference_id uuid,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint inventory_movements_quantity_positive check (quantity > 0),
  constraint inventory_movements_previous_quantity_not_negative check (previous_quantity >= 0),
  constraint inventory_movements_new_quantity_not_negative check (new_quantity >= 0),
  constraint inventory_movements_action_type_allowed check (
    action_type in (
      'receive_stock',
      'internal_transfer',
      'return_to_warehouse',
      'sale',
      'adjustment'
    )
  ),
  constraint inventory_movements_from_location_allowed check (
    from_location is null
    or from_location in ('warehouse', 'dubai_showroom', 'abudhabi_showroom', 'mockup', 'temporary_out', 'sold')
  ),
  constraint inventory_movements_to_location_allowed check (
    to_location is null
    or to_location in ('warehouse', 'dubai_showroom', 'abudhabi_showroom', 'mockup', 'temporary_out', 'sold')
  ),
  constraint inventory_movements_reference_type_allowed check (
    reference_type in ('manual', 'product_request', 'take_item', 'adjustment')
  )
);

create table if not exists inventory.movement_requests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references inventory.products(id) on delete restrict,
  -- request_type controls submission permissions; stock movement_type/action_type remain unchanged.
  request_type text not null,
  constraint movement_requests_request_type_allowed check (request_type in ('take', 'move', 'hold', 'book')),
  movement_type inventory.inventory_movement_type not null,
  action_type text not null default 'internal_transfer',
  from_location text,
  to_location text,
  quantity integer not null,
  note text,
  request_status inventory.product_request_status not null default 'pending_review',
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  approved_movement_id uuid references inventory.movements(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_movement_requests_action_type_allowed check (
    action_type in (
      'receive_stock',
      'internal_transfer',
      'return_to_warehouse',
      'sale',
      'adjustment'
    )
  ),
  constraint inventory_movement_requests_from_location_allowed check (
    from_location is null
    or from_location in ('warehouse', 'dubai_showroom', 'abudhabi_showroom', 'mockup', 'temporary_out', 'sold')
  ),
  constraint inventory_movement_requests_to_location_allowed check (
    to_location is null
    or to_location in ('warehouse', 'dubai_showroom', 'abudhabi_showroom', 'mockup', 'temporary_out', 'sold')
  ),
  constraint inventory_movement_requests_quantity_positive check (quantity > 0)
);

create unique index if not exists categories_root_slug_key
  on inventory.categories (slug)
  where parent_id is null;

create unique index if not exists categories_child_slug_key
  on inventory.categories (parent_id, slug)
  where parent_id is not null;

create unique index if not exists products_active_item_code_key
  on inventory.products (lower(item_code))
  where is_active;

create unique index if not exists products_active_stock_ref_key
  on inventory.products (lower(stock_ref))
  where is_active;

create unique index if not exists product_images_product_sort_order_key
  on inventory.product_images (product_id, sort_order)
  where product_id is not null;

create unique index if not exists product_images_request_sort_order_key
  on inventory.product_images (product_request_id, sort_order)
  where product_request_id is not null;

create unique index if not exists product_images_product_main_key
  on inventory.product_images (product_id)
  where product_id is not null and is_main;

create unique index if not exists product_images_request_main_key
  on inventory.product_images (product_request_id)
  where product_request_id is not null and is_main;

create index if not exists categories_parent_idx on inventory.categories (parent_id);

create index if not exists products_brand_idx on inventory.products (brand_id);

create index if not exists products_category_idx on inventory.products (category_id);

create index if not exists products_status_idx on inventory.products (status);

create index if not exists products_active_idx on inventory.products (is_active);

create index if not exists product_requests_status_idx on inventory.product_requests (request_status);

create index if not exists product_requests_submitted_by_idx on inventory.product_requests (submitted_by);

create index if not exists inventory_movements_product_idx on inventory.movements (product_id);

create index if not exists inventory_movements_created_at_idx on inventory.movements (created_at desc);

create index if not exists inventory_movement_requests_status_idx
  on inventory.movement_requests (request_status);

create index if not exists inventory_movement_requests_product_idx
  on inventory.movement_requests (product_id);

create index if not exists inventory_movement_requests_submitted_by_idx
  on inventory.movement_requests (submitted_by);

create index if not exists products_stock_distribution_idx on inventory.products (
  warehouse_quantity, dubai_showroom_quantity, abudhabi_showroom_quantity, mockup_quantity, temporary_out_quantity
);
create index if not exists inventory_movements_action_location_idx on inventory.movements (action_type, from_location, to_location);
create index if not exists products_item_type_idx on inventory.products (item_type);

drop trigger if exists set_categories_updated_at on inventory.categories;
create trigger set_categories_updated_at before update on inventory.categories
for each row execute function inventory.set_updated_at();

drop trigger if exists set_products_updated_at on inventory.products;
create trigger set_products_updated_at before update on inventory.products
for each row execute function inventory.set_updated_at();

drop trigger if exists set_product_requests_updated_at on inventory.product_requests;
create trigger set_product_requests_updated_at before update on inventory.product_requests
for each row execute function inventory.set_updated_at();

drop trigger if exists set_product_images_updated_at on inventory.product_images;
create trigger set_product_images_updated_at before update on inventory.product_images
for each row execute function inventory.set_updated_at();

drop trigger if exists set_movement_requests_updated_at on inventory.movement_requests;
create trigger set_movement_requests_updated_at before update on inventory.movement_requests
for each row execute function inventory.set_updated_at();

-- Location display names: warehouse = Warehouse; dubai_showroom = Dubai Showroom;
-- abudhabi_showroom = Abu Dhabi Showroom; mockup = Mockup;
-- temporary_out = Temporary Out; sold = Sold. Sold is cumulative and excluded from live quantity.
comment on column inventory.products.location is 'Optional free-text description; movement from/to_location use the six controlled location codes.';
comment on column inventory.movements.from_location is 'warehouse=Warehouse; dubai_showroom=Dubai Showroom; abudhabi_showroom=Abu Dhabi Showroom; mockup=Mockup; temporary_out=Temporary Out; sold=Sold.';
comment on column inventory.movements.to_location is 'Uses the same six controlled codes as from_location.';
comment on column inventory.movement_requests.from_location is 'Uses the same six controlled codes as inventory.movements.from_location.';
comment on column inventory.movement_requests.to_location is 'Uses the same six controlled codes as inventory.movements.from_location.';
comment on column inventory.movement_requests.request_type is 'Submission intent: take/move for warehouse requests, hold/book for office requests; managers may submit any of the four. Does not change stock.';
comment on type inventory.product_request_status is 'Original request states retained: pending_review, approved, rejected.';
comment on table inventory.product_images is 'At most three images per product or product request; unique sort positions 0-2 and at most one main image, which must have sort_order=0.';
comment on table inventory.movements is 'Stock movement history. This migration adds no stock-changing approval functions.';

-- Reference categories only; no brands or business records are seeded.
insert into inventory.categories (name, slug, sort_order)
values
  ('Chair', 'chair', 10),
  ('Desk', 'desk', 20),
  ('Table', 'table', 30),
  ('Storage', 'storage', 40),
  ('Sofa', 'sofa', 50),
  ('Partition', 'partition', 60),
  ('Reception', 'reception', 70),
  ('Booth', 'booth', 80),
  ('Hardware', 'hardware', 90),
  ('Accessory', 'accessory', 100),
  ('Miscellaneous', 'miscellaneous', 110)
on conflict do nothing;

insert into inventory.categories (parent_id, name, slug, sort_order)
select parent.id, child.name, child.slug, child.sort_order
from (
  values
    ('chair', 'Task Chair', 'task-chair', 10),
    ('chair', 'Executive Chair', 'executive-chair', 20),
    ('chair', 'Visitor Chair', 'visitor-chair', 30),
    ('chair', 'Meeting Chair', 'meeting-chair', 40),
    ('chair', 'Lounge Chair', 'lounge-chair', 50),
    ('chair', 'Bar Stool', 'bar-stool', 60),
    ('desk', 'Executive Desk', 'executive-desk', 10),
    ('desk', 'Workstation', 'workstation', 20),
    ('desk', 'Height Adjustable Desk', 'height-adjustable-desk', 30),
    ('table', 'Meeting Table', 'meeting-table', 10),
    ('table', 'Conference Table', 'conference-table', 20),
    ('table', 'Coffee Table', 'coffee-table', 30),
    ('table', 'Side Table', 'side-table', 40),
    ('table', 'Training Table', 'training-table', 50),
    ('storage', 'Cabinet', 'cabinet', 10),
    ('storage', 'Pedestal', 'pedestal', 20),
    ('storage', 'Mobile Pedestal', 'mobile-pedestal', 30),
    ('storage', 'Filing Cabinet', 'filing-cabinet', 40),
    ('storage', 'Bookshelf', 'bookshelf', 50),
    ('storage', 'Locker', 'locker', 60),
    ('storage', 'Credenza', 'credenza', 70),
    ('storage', 'Sideboard', 'sideboard', 80),
    ('sofa', 'Lounge Sofa', 'lounge-sofa', 10),
    ('sofa', 'Modular Sofa', 'modular-sofa', 20),
    ('sofa', 'Armchair', 'armchair', 30),
    ('sofa', 'Ottoman', 'ottoman', 40),
    ('sofa', 'Pouf', 'pouf', 50),
    ('partition', 'Partition', 'partition', 10),
    ('partition', 'Acoustic Panel', 'acoustic-panel', 20),
    ('partition', 'Screen', 'screen', 30),
    ('reception', 'Reception Desk', 'reception-desk', 10),
    ('reception', 'Reception Counter', 'reception-counter', 20),
    ('booth', 'Phone Booth', 'phone-booth', 10),
    ('booth', 'Meeting Booth', 'meeting-booth', 20),
    ('booth', 'Meeting Pod', 'meeting-pod', 30),
    ('hardware', 'Drawer Slide', 'drawer-slide', 10),
    ('hardware', 'Hinge', 'hinge', 20),
    ('hardware', 'Lock', 'lock', 30),
    ('hardware', 'Handle', 'handle', 40),
    ('hardware', 'Bracket', 'bracket', 50),
    ('hardware', 'Leg / Base', 'leg-base', 60),
    ('hardware', 'Castor / Wheel', 'castor-wheel', 70),
    ('accessory', 'Monitor Arm', 'monitor-arm', 10),
    ('accessory', 'Power Module', 'power-module', 20),
    ('accessory', 'Cable Tray', 'cable-tray', 30),
    ('accessory', 'Whiteboard', 'whiteboard', 40),
    ('accessory', 'Planter', 'planter', 50),
    ('accessory', 'Coat Stand', 'coat-stand', 60),
    ('accessory', 'Shelf', 'shelf', 70),
    ('miscellaneous', 'Custom Furniture', 'custom-furniture', 10),
    ('miscellaneous', 'Other', 'other', 20)
) as child(parent_slug, name, slug, sort_order)
join inventory.categories parent
  on parent.slug = child.parent_slug
  and parent.parent_id is null
on conflict do nothing;

-- ROLLBACK (manual; first undo the RLS/storage migration).
-- BEGIN;
-- drop table if exists inventory.product_images;
-- drop table if exists inventory.movement_requests;
-- drop table if exists inventory.product_requests;
-- drop table if exists inventory.movements;
-- drop table if exists inventory.products;
-- drop table if exists inventory.categories;
-- drop function if exists inventory.can_view();
-- drop function if exists inventory.can_manage();
-- drop function if exists inventory.can_request_hold_book();
-- drop function if exists inventory.can_request_add_take();
-- drop function if exists inventory.set_updated_at();
-- drop type if exists inventory.dimension_unit;
-- drop type if exists inventory.inventory_movement_type;
-- drop type if exists inventory.product_request_status;
-- drop type if exists inventory.product_source;
-- drop type if exists inventory.product_condition;
-- drop type if exists inventory.product_status;
-- drop schema if exists inventory;
-- COMMIT;
