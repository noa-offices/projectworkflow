# Task 19b review actions

Model routing for the primary session was not exposed. Independent review used GPT-6 Astra, High effort.

Saved decisions are separate from the read-only check. Product prices, the Smart Setup draft, and Apply are unchanged. No migration was applied to a connected database.

Changed files:
- `supabase/migrations/20261028100000_supplier_price_review_decisions.sql`: table, manager-only RPCs, validation, audit trigger.
- `supabase/tests/supplier_price_review_decisions{.sql,_TEST.sql,.test.mts}`: rollback contract, combined pre-apply preview, disposable PostgreSQL runner.
- `lib/products/supplier-review-decisions.ts`, `supplier-review-decision-service.ts`, their tests, and `smart-setup-supplier-review.ts`: validation, stale snapshots, guarded persistence, CSV.
- `app/products/supplier-review-decision-actions.ts`, `smart-setup-supplier-check-actions.ts`: authenticated actions and manager capability.
- `components/products/smart-setup-supplier-review-dialog.tsx`, `smart-setup-supplier-verification.tsx`, `use-supplier-review-decisions.ts`, `supplier-review-decision-controls.tsx`, and related tests: local decisions, bulk controls, filters, save/close flow, responsive cards, counts.
- The implementation plan and this artifact directory: verification record and screenshots.

Reused `inventory.can_manage()` / `canSeeCosts`, the checked source version ID, existing review/status helpers, the CSV injection guard, and `formatDubaiDateTime`.

Verification: 33 focused tests passed; typecheck and touched-file lint passed. Six browser scenario groups passed with zero browser errors. Screenshots: [1440](supplier-review-1440.png), [1024](supplier-review-1024.png), [390](supplier-review-390.png). The browser fixture mounts the real components with in-memory actions; the SQL contract runs in disposable PGlite and rolls back schema and test data. Live Supabase/PostgREST and signed-in end-to-end persistence were not tested.

Decisions made: Not decided cancels a saved record; conflicting duplicate code/price-field rows are blocked; custom/kept amounts retain the imported currency; CSV exports saved decisions; manager rows are all rendered without paging (max 500, controls vary row height) with responsive cards below 1280 px; saves use batches of 200 with partial-failure recovery; concurrent saves use the latest successful write.

Run SQL in this order:
1. **TEST first:** [`supplier_price_review_decisions_TEST.sql`](../../supabase/tests/supplier_price_review_decisions_TEST.sql). Contains the migration and assertions inside one transaction, ending in ROLLBACK.
2. **APPLY second:** [`20261028100000_supplier_price_review_decisions.sql`](../../supabase/migrations/20261028100000_supplier_price_review_decisions.sql). This is the only migration file. Apply only after the TEST succeeds.

The standalone [`supplier_price_review_decisions.sql`](../../supabase/tests/supplier_price_review_decisions.sql) can be rerun after APPLY; it also rolls back its fixtures. All SQL tests use reserved fake rows only.

Products suite: 1919 pass, 50 fail; the 50 failures are identical to main.

Finished by Claude: removed the 50-row manager paging, footer "N decided" now loads right after a check (hidden until known), CSV BOM written as `﻿`.
