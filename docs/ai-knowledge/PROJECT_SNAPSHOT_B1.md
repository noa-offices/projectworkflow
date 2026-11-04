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

## Project scope (Step B2)

`lib/projects/project-scope.ts` (`loadProjectScope`) is the one place that reads what a Project is made of: header, sections and items. A Project with a frozen copy (`project_snapshots*`) reads the copy, with exact row counts and the original ids; a missing, failed or partial read falls back to the live quotation exactly as before. Readers switched: the Project page, both procurement order pages and the Project documents (`loadQuotationDerivedDocumentData(id, { projectScope: true })`: purchase order, RFQ, order confirmation, delivery note and their downloads). Not switched: lists (Project File flags and contract total only), payments (contract total only), the CRM project folder, the quotation pages and the quotation Excel export, and NOA. Lifecycle flags (completed, cancelled) stay on the live quotation. Step C2 changes this module only: it will return the latest applied variation instead of the original copy.

## Applied variations (Step C2a)

`apply_project_variation` (migration `20261108100000_project_variations.sql`) saves a Client Confirmed variation as immutable history in `project_variations`, `project_variation_sections` and `project_variation_items`, and marks the variation with `layout_settings.variationApplied`, which locks it. The original copy is never edited. `loadProjectScope` returns the latest applied variation as the current scope, then the original copy, then the live quotation. Its header stays the Project's: id, title and Project File are the Project's own. Lines keep the id they had in the previous scope; row ids are not stable across publishes, so lines are matched at apply time on template, code and name. Procurement progress and vendor documents are keyed by order number and normalised vendor name, so they are not affected by item ids.

Payments are unchanged: they read `entry.order.total` (`projectFile.total`). For Step C2b, the places are the Project page (`contractTotal` prop and the balance line), `components/projects/client-payment-panel.tsx`, `lib/projects/client-payment-actions.ts` and `client-payment-attachment-actions.ts`, and the database check in migration 092. Still on the original total: the dashboard value, sales reports, NOA and the local read cache's Project summaries.
