# Project snapshot: Step B1

A frozen copy of the approved quotation, kept for the Project. B1 only stores it. **No page, procurement code or document reads it yet, and nothing visible changes.**

## What exists

- Migration `supabase/migrations/20261107100000_project_snapshots.sql`. To review and apply: `supabase/tests/project_snapshots_TEST.sql` (rolled back), then `supabase/tests/project_snapshots.sql`.
- Tables `project_snapshots` (one per Project; `quotation_id` and `order_no` unique), `project_snapshot_sections` and `project_snapshot_items`. Every active row is copied, with typed columns plus the full original row in `data`. The `projects` table is the CRM client folder and is not related.
- Closed: RLS on and no write grants. Read follows the source quotation: the policies look it up, so its RLS decides. Rows cannot be updated, deleted or truncated.
- `create_project_snapshot(uuid)`: the same roles as `requireRecordsManager`. Idempotent. Raises if the copied items do not reach the stored grand total.
- `backfill_project_snapshots()`: System Owner only, 50 new snapshots per call, safe to re-run.
- `project_snapshot_state(uuid[])`: 1 to 50 quotations, for B2. Security invoker, so a quotation the user cannot read shows no snapshot.
- `lib/quotations/project-snapshot.ts`: the shape, the totals-match rule (mirrors the SQL) and `saveProjectSnapshot`, which never throws.

`createProjectFileFromQuotation` calls `saveProjectSnapshot` after the Project File is written. A missing function is only logged. A failure is logged and adds one sentence to the success message. Either way the Project File stands, and backfill picks up the copy.

## Totals rule

Whole AED: the copied items must produce the stored total to the cent. Legacy: the round-up-to-5 total, the exact total within 0.01 (the local builder's binary fractions), or the exact total rounded up to 5 (a legacy Project File total).

## Running the backfill

Run it after the migration, as a System Owner. In the SQL editor there is no signed-in user, so set one for the transaction, and repeat until `remaining` stops falling:

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<system owner profile id>')::text, true);
select public.backfill_project_snapshots();
commit;
```

A backfilled copy holds what the quotation holds today. It is not proof of what was approved, because edits made before Step A may be in it. `differences` lists those whose items do not reach the frozen contract total. Skipped and listed, never copied: a Project File copied from another quotation, and old confirmed orders with no Project File.

## Next

- **B2:** switch Project, procurement, payment-context and Project document readers to the copy (see `PROJECT_SNAPSHOT_STEP_B_STUDY.md`), using `project_snapshot_state` and falling back to live data where no copy exists.
- **B3:** a database guard on `quotations`, `quotation_items` and `quotation_sections` so direct writes cannot change a locked quotation.
