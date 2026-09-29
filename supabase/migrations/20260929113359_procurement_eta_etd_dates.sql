-- ETA/ETD are date-only business values. Requires PostgreSQL 16+ (pg_input_is_valid).
-- Existing exact, valid YYYY-MM-DD values are preserved. NULL and empty text become NULL.
-- Invalid legacy text (including locale dates, whitespace-padded dates, timestamps and
-- impossible calendar dates) is deliberately cleared to NULL, never guessed/reinterpreted.
-- A count-only NOTICE reports cleared nonempty values; no business values are logged.
-- Already-date columns are left untouched, allowing safely pre-hardened environments.
BEGIN;
SET LOCAL DateStyle = 'ISO, YMD';
DO $$
DECLARE
  date_column text;
  column_type text;
  invalid_count bigint;
BEGIN
  FOREACH date_column IN ARRAY ARRAY['etd', 'eta'] LOOP
    SELECT data_type INTO column_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'procurement_vendor_progress'
        AND column_name = date_column;
    IF column_type = 'date' THEN
      CONTINUE;
    END IF;
    IF column_type IS DISTINCT FROM 'text' THEN
      RAISE EXCEPTION 'Unexpected type for procurement_vendor_progress.%: %', date_column, column_type;
    END IF;
    EXECUTE format(
      'SELECT count(*) FROM public.procurement_vendor_progress WHERE %1$I IS NOT NULL AND %1$I <> '''' AND NOT (%1$I ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(%1$I, ''date''))',
      date_column) INTO invalid_count;
    RAISE NOTICE 'procurement_vendor_progress.%: clearing % invalid legacy date values to NULL', date_column, invalid_count;
    EXECUTE format(
      'ALTER TABLE public.procurement_vendor_progress ALTER COLUMN %1$I TYPE date USING (CASE WHEN %1$I ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(%1$I, ''date'') THEN %1$I::date ELSE NULL END)',
      date_column);
  END LOOP;
END $$;
COMMIT;
