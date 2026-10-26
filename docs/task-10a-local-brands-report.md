# Task 10a: Inventory-only brands and No brand

Branch: `phase-10a/local-brands`, based on updated `main`. No connected database was changed. The migration is left unapplied for the owner to review and apply. Tests used disposable in-memory PGlite only.

## Changes

- Added one migration defining `inventory.local_brands`, normalized unique names/codes, public-code clash checks, nullable mutually exclusive public/local identities, protected list/create/rename/deactivate functions and deny-by-default RLS with no table grants.
- Kept the original public-brand counter table/helper and all existing references intact. A separate Inventory counter handles local brands and the fixed GEN prefix for No brand. Active legacy reference collisions are skipped case-insensitively.
- Updated submit, review-with-edits and manager edit payloads. Costs/prices keep their existing authorization and calculations. Edits preserve the original stock reference.
- Reused the PW form styles for a shared grouped picker in Add item, request/review and Edit item. Only managers see creation; inactive current selections remain in their original group.
- Added local/No-brand filters, historical labels, brand-name search, movement/report brand output, empty no-brand detail labels and hidden no-brand card glass. Local label reads paginate in bounded chunks.
- Added rollback SQL assertions, offline harness, action/validation/query/UI/report tests and preview fixtures. Added no dependencies or new design system. Existing unrelated untracked workspace files were preserved.

## Verification

- Inventory unit/UI/report/offline SQL suite: **205 passed, 0 failed**.
- Final picker/label UI rerun after grouping changes: **34 passed**.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` passed.
- Scoped lint: Inventory components/library and preview page **passed (exit 0)**.
- Mobile browser preview: **360, 390 and 430 px passed** creation, No brand, edit, worker visibility, report/product filters and horizontal-overflow checks. Screenshots are in `artifacts/task-10a-{create,reports,filters}-{width}.png`.
- Repository-wide offline run: **4,568 passed, 64 failed, 2 skipped (4,634 total)**. All 64 failed titles reproduced on a temporary main snapshot: **405 passed, same 64 failed** across the 32 failing files. No additional failed title. The temporary source snapshot and its dependency junction were removed after comparison.
- Repository-wide lint: **5 existing errors, 39 warnings**. The errors are `react-hooks/set-state-in-effect` in unchanged `components/notifications/notification-bell.tsx` (58, 66), `components/notifications/notifications-page-content.tsx` (61), `components/notifications/notifications-tabs.tsx` (77), and `components/ui/resolved-avatar.tsx` (21).
- `git diff --check` passed.

The repository-wide run preceded the last small Inventory-only regression additions; the final targeted suite and picker/mobile reruns cover those additions.

Local evidence: `artifacts/task-10a-tests.log`, `artifacts/task-10a-picker-final.log`, `artifacts/task-10a-typecheck.log`, `artifacts/task-10a-inventory-lint-final.log`, `artifacts/task-10a-mobile.log`, `artifacts/task-10a-all-tests.log`, `artifacts/task-10a-baseline-tests.log`, `artifacts/task-10a-baseline-comparison.json`, `artifacts/task-10a-lint.log`.

## Not tested

- No migration was applied to a connected/local Supabase instance. Real PostgREST schema-cache refresh and authenticated live database saves were not exercised.
- No production deployment/build, production report download, physical PDF rendering/printing, or simultaneous multi-session counter contention test. Generated report HTML/workbook tests and transactional SQL behavior were exercised offline.
- The two repository tests skipped by their existing conditions were not exercised. Unrelated main-branch test/lint failures were preserved.

## Decisions made

- Default the optional picker to **No brand** and reserve `GEN` from Inventory-only codes.
- Preserve public-brand counter storage/helper unchanged; use a separate Inventory counter for local/No-brand refs.
- Keep codes immutable through the exposed management API; rename changes names only, deactivate preserves history. Management RPCs are provided without adding a separate brand administration screen.
- Expose active choices and historical names through separate role-checked RPCs; do not grant direct local-brand table access.
- Preserve stock refs on brand edits. Send both identity keys on cross-kind edits to clear the old identity explicitly.
- Add an explicit Brand column to movement Excel output and suppress the empty Brand field on no-brand product/request details.
- The Supabase CLI was unavailable; the single migration file was authored using the repository timestamp naming convention, with no dependency installation.
- Proceed with existing Inventory patterns as explicitly authorized; no frontend-design plugin was used.

## Files changed

- `app/dev/inventory-preview/page.tsx`
- `components/inventory/brand-picker.tsx`
- `components/inventory/movements-view.tsx`
- `components/inventory/product-detail-view.tsx`
- `components/inventory/product-edit-form.tsx`
- `components/inventory/product-filters.tsx`
- `components/inventory/product-request-form.tsx`
- `components/inventory/reports-view.tsx`
- `components/inventory/requests-view.tsx`
- `docs/superpowers/plans/2026-10-26-inventory-local-brands.md`
- `docs/task-10a-local-brands-report.md`
- `lib/inventory/action-errors.ts`
- `lib/inventory/action-validation.test.mts`
- `lib/inventory/action-validation.ts`
- `lib/inventory/actions.test.mts`
- `lib/inventory/actions.ts`
- `lib/inventory/brands.test.mts`
- `lib/inventory/brands.ts`
- `lib/inventory/filters.ts`
- `lib/inventory/mapping.ts`
- `lib/inventory/presentation.ts`
- `lib/inventory/preview-data.ts`
- `lib/inventory/product-edit.test.mts`
- `lib/inventory/product-edit.ts`
- `lib/inventory/product-request-submission.ts`
- `lib/inventory/queries.test.mts`
- `lib/inventory/queries.ts`
- `lib/inventory/reports/movements-report.ts`
- `lib/inventory/reports/params.ts`
- `lib/inventory/reports/reports.test.mts`
- `lib/inventory/types.ts`
- `lib/inventory/ui.test.mts`
- `supabase/migrations/20261026100000_inventory_local_brands.sql`
- `supabase/tests/inventory_local_brands.sql`
- `supabase/tests/inventory_local_brands.test.mts`

## Verification artifacts created

- `artifacts/task-10a-create-360.png`
- `artifacts/task-10a-create-390.png`
- `artifacts/task-10a-create-430.png`
- `artifacts/task-10a-filters-360.png`
- `artifacts/task-10a-filters-390.png`
- `artifacts/task-10a-filters-430.png`
- `artifacts/task-10a-reports-360.png`
- `artifacts/task-10a-reports-390.png`
- `artifacts/task-10a-reports-430.png`
- `artifacts/task-10a-baseline-comparison.json`

## Existing repository test failures (same titles on main)

- 1-3: existing templates get a direct Edit in Smart Setup entry that skips the scope dialog and does not open Add More
- 11: all Matrix price columns remain visible and directly editable in the collapsed row
- 12. Procurement subsection calls requireProcurementManager() before any procurement read
- 13: manual visual subgroup controls remain available for Base/Model rows
- 21: a different page or search replaces (never keeps) a stale highlight; unmatched text clears it
- 25. a Product Price permission failure does not throw or fail the whole result - Procurement still proceeds
- 26-28: create/import workflow, Source QA in import mode and the quick-edit save path are unchanged
- 26. a Procurement permission failure does not throw or fail the whole result
- 2: collapsing Source QA hides the missing-from-JSON list and AI report, gating them behind expanded
- 2: create mode does not render it and keeps Import & Review JSON
- 4. the payment tables are only ever read when clientPaymentsAvailable is true
- 4: expanding Source QA restores Run Source QA, Crop Images, and Upload / Replace PDF exactly as before
- 5. a Client Payment denial does not affect Product Price findings
- 6. a Client Payment denial does not affect Procurement findings
- 6: existing Source QA wiring (Run Source QA, Crop Image, Ignore, crop event, upload) is unchanged
- 6: manual "+ Add price category column" still works and no longer injects Cat A-D as a side effect
- 7. Product Price subsection calls requireProductLibraryManager() before any product read
- 7. the Client Payment subsection reuses the shared bounded active Project File set
- 7: applySmartAdditionalJson's addedRowsByTarget is threaded through onAdd for Base/Model subgroup row_id assignment
- 7: existing explicit visual subgroup assignments remain authoritative and are never overwritten by inference
- 8: Category/Matrix (non-modular) import already behaves the same way — every call site passes includeDefaultPriceCategories: false
- Archive/Discontinued UI: quotation usage warns (delete available), linked-family usage still hard-blocks
- History hides archived by default, offers View / Download / Archive, and hides permanent delete from non-owners
- Matrix Modular: price maps and matrix columns survive Draft -> Apply unchanged (7)
- Matrix Modular: unavailableCategoryIds survive Draft -> Apply unchanged (8)
- Product Management and Local Builder load one shared Supplier Family status map
- Product Management filter bar navigation always sets manage=1 and preserves panelBrand/panelMain/panelSub by copying the existing query string
- Product Management row action forms (mark checked, archive, discontinue) all submit a return_to hidden field sourced from the row's returnTo prop
- ProductManagementTemplateResults threads its returnTo prop into every row's TemplateRowActions, and page.tsx supplies managementListHref at every call site
- Smart Setup stays open on a pending save and only closes for a completed ordinary Apply
- Source QA defaults to expanded before a PDF is uploaded and auto-collapses once, without re-collapsing on later toggles
- System quantity is not an accessory quantity: the evaluator receives no System quantity for base_model targets
- UI parity 10: inferred subgroup membership computation is unchanged by this presentation-only task
- UI parity 1: normal Base/Model review does not unconditionally render the large subgroup-management block
- UI parity 8: Manage groups exposes rename/Assign/Remove controls only once opened
- all five adapters independently preserve null, zero, numbers, and hierarchy
- app/layout.tsx derives NOA auth via a non-redirecting Supabase lookup, not a require* helper
- archiveProductTemplate reads returnPath(formData) and redirects via redirectWithMessageToPath, never the context-blind redirectWithMessage
- both pages load coverage/legacy evidence, inherit intervals and share the helper without filter redesign
- cache-first navigation instruments reads and waits for authoritative API without queued writes
- component wiring: confirmations, single flight, preflight and honest status
- components\products\source-qa-panel.test.mts
- createProductTemplate success no longer hardcodes manage=1/panelBrand and instead merges onto returnPath(formData)
- direct-priced groups are exempt from the shared category-column contract and still map to runtime
- editor interception is offline-only; authoritative GET and editor write behavior remain separate
- grouped cards are wired across every supported Smart Setup pricing destination
- lib\products\source-qa-ai-provider.test.mts
- lib\products\specification-enrichment-provider.test.mts
- lib\quotations\final-specification-ai-provider.test.mts
- mark-checked form specifically submits return_to (Part 4: no change to markTemplatePriceChecked's own action logic)
- markProductTemplateDiscontinued reads returnPath(formData) and redirects via redirectWithMessageToPath, never the context-blind redirectWithMessage
- one compatible matrix preserves source order and price values
- ordinary Apply-to-Product-Template import flow and quick-edit save are unchanged
- page header and wiring keep the route and behavior while using shared ProjectWorkflow patterns
- permanent-delete server action is owner-only, confirms before RPC, and reports retryable Storage failure
- permanentlyDeleteProductTemplate nulls quotation_item_price_history.source_template_id before deleting the template, and aborts on failure
- permanentlyDeleteProductTemplate still blocks active templates and still hard-blocks on linked families
- recommendations are editable and reviewed destinations are authoritative
- restoreProductTemplate reads returnPath(formData) and redirects via redirectWithMessageToPath, never the context-blind redirectWithMessage
- returnPath/pathWithParams (the safe internal-path helpers) are unchanged and still reused, not duplicated
- root cause fix: the saved modular_item_pricing payload includes price_categories for Matrix Modular groups, not only Direct Modular
- template save, replacement and explicit cancellation are wired to non-blocking temporary cleanup
- the contract example presents one entry per shape instead of one mixed misleading sample
- wiring: reviewer/approver gates, no price writes, one confirmation, honest success, Manage Previous Versions
