alter table public.quotations
add column if not exists approved_salesperson_id uuid references public.profiles(id);

update public.quotations
set approved_salesperson_id = salesperson_id
where approved_salesperson_id is null
  and salesperson_id is not null
  and status = 'client_confirmed'
  and (
    nullif(btrim(layout_settings #>> '{projectFile,orderNo}'), '') is not null
    or nullif(btrim(layout_settings #>> '{clientApprovalDraft,confirmedOrder,orderNo}'), '') is not null
    or nullif(btrim(layout_settings #>> '{clientApproval,confirmedOrder,orderNo}'), '') is not null
  );
