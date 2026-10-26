# Task 14: Stock ref everywhere

Status: implementation complete on `phase-14/stock-ref-everywhere`. All 246 Inventory tests, typecheck and Inventory lint pass. Mobile checks pass at 360, 390 and 430 px. Repository-wide lint retains 5 pre-existing errors and 39 warnings.

**The notification migration is unapplied:** `supabase/migrations/20261026150000_inventory_stock_ref_notifications.sql`. No connected database has been changed. No database read-function change was needed.

## Changes and decisions

- One shared `inventoryIdentifier` helper builds Stock ref, then nonblank `Code …` and `Model …`, with no empty separators. New-item requests without a ref show `Ref assigned on approval`; approved requests prefer the resulting product's ref.
- Product/request cards and details, Overview activity, reservations, pending requests, movements, move/hold/book forms and report pickers use the helper. Overview and per-product pending requests/reservations carry product identifiers through existing signed-in reads. Access and costs remain unchanged.
- Excel/PDF retain dedicated structured identifier columns and also show the shared identifying line beneath the item name. Excel rows grow for long names/identifiers so the ref is not clipped. Existing report totals, dates and photo paths are preserved.
- Search retains Stock ref, item code, model and manager person matching. Preview request/report search was brought into line with these existing production rules.
- Notification bodies are created by four database triggers. The existing body and broad Requests link do not identify the originating row reliably, so a client-only lookup could match the wrong item. The unapplied migration changes only these triggers' formatting/identifier reads. Recipients, role checks, error isolation and trigger-only permissions remain unchanged.
- Historical notification text is not backfilled: it has no reliable item/request ID. Future notifications include refs after the user applies the migration. No real notifications were sent during verification.
- Supabase CLI is unavailable; the migration filename follows this repository's timestamp convention without installing dependencies.

## Checked screens and tests

- Unit rendering: product request cards, movement request cards, approved new-item requests, Overview pending cards, reservations, product cards/detail, existing role/cost controls.
- Identifier helper: ref only, ref + code, ref + model, all three, trimmed/blank values, pending new item, missing historical item, existing GEN ref.
- Mapping: movement requests, per-product pending movement requests, reservations and Overview return refs through the existing product reads.
- Disposable rollback-only SQL: notification recipients, pending label, public-brand ref, generated GEN ref on approval, optional code/model, rejected requests, no empty separators, trigger privileges and failure isolation. Migration is also checked for repeatability. No connected database SQL was executed.
- Final checks: 246/246 Inventory tests passed, zero failures/skips; typecheck passed; Inventory lint passed. All SQL ran only in disposable in-memory PGlite.
- Repository-wide lint reports the same 5 existing `react-hooks/set-state-in-effect` errors and 39 warnings as Tasks 10a/11/12. The errors are unchanged effect code in `notification-bell.tsx` (two), `notifications-page-content.tsx`, `notifications-tabs.tsx` and `resolved-avatar.tsx`. This task adds no lint errors or warnings.
- Independent review caught the bell truncation and missing form/filter identifiers; these were fixed with regressions. Inventory notifications keep their full identifying line, including long names, and preserve line breaks. Other notification previews retain their existing truncation.
- Chromium mobile preview checked the following screens at all three widths without overflow or page errors. Actions were not submitted:

- Requests > Movement requests (including a GEN ref with no optional code/model)
- Movement request details
- Requests > Product requests (pending, approved and rejected)
- Product request details
- Review and approve item form
- Manager Overview pending/recent lists
- Products grid and identifier lines
- Product detail header and reservations
- Permanent delete confirmation (render only)
- Product detail with ref only
- Movements list and selected-product filter
- Move stock search results
- Move stock selected item
- Book stock form
- Hold stock form
- Edit item header
- Manage photos header
- Remove/archive confirmation (render only)
- Warehouse new-item request form
- Reports product search results
- Reports selected-product filter

Additional checks: pending requests on a product page and notification bell/received/sent lists were checked through component rendering tests; current-inventory and movements Excel cells/columns were checked through workbook tests; current-inventory PDF HTML was rendered in Chromium print media and visually inspected.

## Not tested

- Applying the migration to Supabase, live notification delivery, or backfilling historical notification bodies.
- Physical phones or live production accounts/data.
- Desktop Excel, actual PDF download/printing and the production PDF renderer; print HTML and workbook contents were checked locally.
- Full unrelated application test suite.

## Files changed

- `app/api/inventory/reports/movements/route.ts`
- `app/dev/inventory-preview/page.tsx`
- `app/inventory/movements/page.tsx`
- `app/inventory/products/[id]/photos/page.tsx`
- `artifacts/task-14-browser-results.json`
- `artifacts/task-14-mobile-check.mjs`
- `components/inventory/delete-item-button.tsx`
- `components/inventory/move-stock-form.tsx`
- `components/inventory/movement-request-form.tsx`
- `components/inventory/movements-view.tsx`
- `components/inventory/overview-view.tsx`
- `components/inventory/pending-product-requests.tsx`
- `components/inventory/product-card.tsx`
- `components/inventory/product-detail-view.tsx`
- `components/inventory/product-edit-form.tsx`
- `components/inventory/product-manager-tools.tsx`
- `components/inventory/product-photo-manager.tsx`
- `components/inventory/product-request-form.tsx`
- `components/inventory/product-reservations.tsx`
- `components/inventory/reports-view.tsx`
- `components/inventory/requests-view.tsx`
- `components/notifications/notification-bell.tsx`
- `components/notifications/notifications-page-content.tsx`
- `components/notifications/notifications-tabs.tsx`
- `docs/superpowers/plans/2026-10-26-inventory-stock-ref-everywhere.md`
- `docs/task-14-stock-ref-everywhere-report.md`
- `lib/inventory/identifier.test.mts`
- `lib/inventory/notification-presentation.ts`
- `lib/inventory/presentation.ts`
- `lib/inventory/preview-data.ts`
- `lib/inventory/queries.test.mts`
- `lib/inventory/queries.ts`
- `lib/inventory/reports/current-inventory.ts`
- `lib/inventory/reports/excel-style.ts`
- `lib/inventory/reports/movements-report.ts`
- `lib/inventory/reports/reports.test.mts`
- `lib/inventory/request-preview-data.ts`
- `lib/inventory/types.ts`
- `lib/inventory/ui.test.mts`
- `supabase/migrations/20261026150000_inventory_stock_ref_notifications.sql`
- `supabase/tests/inventory_notifications.sql`
- `supabase/tests/inventory_stock_ref_notifications.test.mts`

Mobile/print screenshots: `artifacts/task-14-*.png` (14 files). Verification logs: `artifacts/task-14-tests-final.log`, `artifacts/task-14-typecheck-final.log`, `artifacts/task-14-inventory-lint-final.log`, `artifacts/task-14-browser-final.log`, `artifacts/task-14-repository-lint.log`. Unrelated existing workspace files were left alone.
