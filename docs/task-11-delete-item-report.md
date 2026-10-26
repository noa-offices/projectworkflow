# Task 11: Permanent Inventory item deletion

**Status:** Implementation, 229 Inventory tests, typecheck, scoped Inventory lint and mobile verification pass. Migration is unapplied. Branch: `phase-11/delete-item` from updated main.

## Implementation

- Added `inventory.delete_product_permanently(uuid)`: manager role check inside SECURITY DEFINER, empty search_path, EXECUTE granted only to authenticated. Active and archived items are supported. Existing `remove_product` archive behavior is unchanged.
- Explicitly deletes owned costs, images, holds/bookings, movements, movement requests, approved product requests and their costs/images in one transaction. It returns only exclusive photo paths in inventory-images; other items, public data and all counters stay unchanged. No notifications are sent.
- Audited every incoming product foreign key: product_costs.product_id (CASCADE), product_images.product_id (CASCADE), product_requests.approved_product_id (SET NULL), movements.product_id (RESTRICT), movement_requests.product_id (RESTRICT), reservations.product_id (RESTRICT). Secondary request-cost/image and request/reservation/movement links are handled explicitly. Future unknown product FKs fail closed.
- Added a manager-only summary RPC/action with exact photo, movement and reservation counts. Separate red Delete item tool opens the existing PW dialog with plain-English irreversible warning and exact Stock ref confirmation. Server checks the current Stock ref again before deletion.
- Server deletes database rows first, then removes returned Storage paths using the existing signed-in Storage helper. Each failed file is counted and its path logged. DB success remains success even when Storage cleanup fails; Products receives a success or partial-cleanup banner.

## Verification

- **229 Inventory unit/UI/report and disposable SQL tests passed.** Includes DB-before-Storage order, role refusal, incorrect ref refusal, success, returned and thrown Storage errors, mixed cleanup outcomes, exact leftover logs, Products banners and manager/archived UI.
- Self-undoing SQL test: worker/designer/viewer/disabled owner denied with 42501; admin and owner allowed; every owned row/request removed; exact returned paths; other item's complete state unchanged; archive then delete; counters unchanged and next GEN reference not reused; anonymous/service role cannot execute; no notifications; unknown FK and cross-item link refusal; late final-delete error rolls all child deletes back. Profiles use ON CONFLICT (id) DO UPDATE; JWT subject is cleared before disabling a user.
- Final typecheck and scoped Inventory lint passed (exit 0).
- Repository-wide lint still reports **5 existing errors and 39 warnings**, all outside the changed Inventory files. Errors are react-hooks/set-state-in-effect in `components/notifications/notification-bell.tsx` (58, 66), `components/notifications/notifications-page-content.tsx` (61), `components/notifications/notifications-tabs.tsx` (77), and `components/ui/resolved-avatar.tsx` (21). These same unchanged-file failures were documented in Task 10a. Output: `artifacts/task-11-repository-lint.log`.
- Mobile Chromium preview passed at **360, 390 and 430 px** for active and archived items: exact warning/counts, incorrect/trailing-space Stock ref rejection, correct ref enabling Delete, preview-only submission, nonmanager invisibility, focus restoration and no horizontal overflow.
- Independent read-only code review found no important defects. Its mixed Storage failure and summary-permission test suggestions were added and passed.
- Migration/test execution used only disposable in-memory PGlite. No connected database or real Storage deletion was performed.

## Not tested

- Real Storage deletions or real production items, including a real item with many photos/request photos.
- Physical phones, phone keyboards and production deployment. Concurrent production delete/stock operations and Storage authorization changes mid-cleanup were not exercised.
- Full unrelated repository suite was not rerun. Existing repository-wide lint/test failures from Task 10a are outside this change.

## Decisions made

- Preserve a Storage object if another item's image metadata still references it; delete only this item's metadata and return exclusive paths. Other buckets are never touched.
- Refuse inconsistent cross-item movement/reservation links rather than mutate another item's data through SET NULL. Refuse unknown future product FKs pending explicit handling.
- Counts include all owned photo rows (including request photos), movement history and all holds/bookings, not just active reservations.
- Confirmation is exact and case-sensitive. It is rechecked against the current DB Stock ref on the server; summary/load failures leave Delete disabled.
- Added a separate read-only summary RPC in the same migration. Edit screen has no tools menu, so no new edit menu was introduced; active/archived product pages expose manager tools.
- Storage cleanup runs per unique path so partial-warning counts and logged leftover paths are exact. Missing files successfully removed/acknowledged by Storage do not count as failures.
- Supabase CLI is unavailable, so the single migration file follows the repository timestamp convention and was authored without dependency installation.

## Files changed

- `app/inventory/products/page.tsx`
- `components/inventory/delete-item-button.tsx`
- `components/inventory/movement-request-form.tsx`
- `components/inventory/product-manager-tools.tsx`
- `docs/superpowers/plans/2026-10-26-inventory-delete-item.md`
- `docs/task-11-delete-item-report.md`
- `lib/inventory/action-errors.ts`
- `lib/inventory/actions.test.mts`
- `lib/inventory/actions.ts`
- `lib/inventory/delete-product.test.mts`
- `lib/inventory/delete-product.ts`
- `lib/inventory/ui.test.mts`
- `supabase/migrations/20261026120000_inventory_delete_product.sql`
- `supabase/tests/inventory_delete_product.sql`
- `supabase/tests/inventory_delete_product.test.mts`

## Verification evidence

- `artifacts/task-11-tests-final.log`: 229 passing Inventory checks.
- `artifacts/task-11-typecheck-final.log`, `artifacts/task-11-lint-final.log`: successful typecheck/scoped lint.
- `artifacts/task-11-browser-results.json`: mobile assertions.
- `artifacts/task-11-active-360.png`, `artifacts/task-11-active-390.png`, `artifacts/task-11-active-430.png`.
- `artifacts/task-11-archived-360.png`, `artifacts/task-11-archived-390.png`, `artifacts/task-11-archived-430.png`.

The initial browser attempt reached unhydrated dev HTML; after the existing dev server completed compilation/cache work, hydrated preview retries passed. No production change was made for this development timing issue.
