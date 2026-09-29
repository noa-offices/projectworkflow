-- Quotation OUTPUT currency must always be AED (business rule). This constrains only
-- quotations.currency, the top-level selling-currency column - it does not touch any
-- source/product pricing table, and source pricing legitimately remains AED/EUR/USD,
-- converted to AED per-item before being added to a quotation.
-- Additive and defensive: ADD CONSTRAINT validates against existing rows automatically,
-- so if any live quotation is already non-AED this migration fails loudly at apply time
-- rather than silently converting historical data or inventing an exchange rate.
alter table public.quotations
  drop constraint if exists quotations_currency_aed_only_check;

alter table public.quotations
  add constraint quotations_currency_aed_only_check
  check (currency = 'AED');
