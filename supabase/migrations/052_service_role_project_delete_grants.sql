grant usage on schema public to service_role;

do $$
begin
  if to_regclass('public.projects') is not null then
    grant select, delete on table public.projects to service_role;
  end if;

  if to_regclass('public.quotations') is not null then
    grant select, delete on table public.quotations to service_role;
  end if;

  if to_regclass('public.quotation_items') is not null then
    grant select, delete on table public.quotation_items to service_role;
  end if;

  if to_regclass('public.quotation_sections') is not null then
    grant select, delete on table public.quotation_sections to service_role;
  end if;

  if to_regclass('public.quotation_item_price_history') is not null then
    grant select, delete on table public.quotation_item_price_history to service_role;
  end if;

  if to_regclass('public.quotation_presentations') is not null then
    grant select, delete on table public.quotation_presentations to service_role;
  end if;

  if to_regclass('public.quotation_procurement_rfqs') is not null then
    grant select, delete on table public.quotation_procurement_rfqs to service_role;
  end if;

  if to_regclass('public.quotation_purchase_orders') is not null then
    grant select, delete on table public.quotation_purchase_orders to service_role;
  end if;

  if to_regclass('public.quotation_order_confirmations') is not null then
    grant select, delete on table public.quotation_order_confirmations to service_role;
  end if;

  if to_regclass('public.audit_activity_log') is not null then
    grant select, delete on table public.audit_activity_log to service_role;
  end if;
end $$;
