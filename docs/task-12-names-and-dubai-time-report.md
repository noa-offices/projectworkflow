# Task 12: Names and Dubai time

Status: complete on `phase-12/names-and-dubai-time`. All 239 Inventory tests, typecheck, Inventory lint and mobile verification pass. Repository-wide lint retains 5 pre-existing errors and 39 warnings. Branch: `phase-12/names-and-dubai-time` from updated main. No database changes.

## Changes

- One shared Intl-based `Asia/Dubai` date module supplies Inventory screens and reports, without a fixed offset. Times display as `26 Oct 2026, 08:56`. Hold-expiry inputs and movement date filters also use Dubai time regardless of device timezone.
- Person labels use full names or `Team member`; never an email fallback. Product history and Movements retain their existing shared actor-name enrichment. Existing profile reads remain signed-in, RLS-protected, and select only `id,full_name`.
- Manager Overview adds up to five pending product requests, pending movement requests, recently added items and recent movements, each with the person's name and Dubai timestamp. Other roles receive no activity query/data. No costs are read for these lists.
- Inventory notification timestamps and person labels in the bell, received list and sent list (direct and broadcast) use the same helpers. Other notification types retain their existing presentation. Existing notification body text is not rewritten.

## Investigation and decisions

- On updated main, product detail and Movements already both called `enrichMovements`/`displayNames`. A regression using the same System Owner account and actor returns the same full name on both. A missing product-specific join or different profile RLS path could not be reproduced. The user confirmed the screenshots came from phone/computer and may have used different accounts. No speculative read-path fix, profile grants, RLS changes or admin-client name lookup were added.
- Missing, blank, `Unknown` and email-shaped names display `Team member`.
- Overview lists show the newest five entries by timestamp and ID; pending counts remain complete. `Added by` means the product's stored `created_by`; `Requested by` means `submitted_by`; `Recorded by` means movement `created_by`.
- Ambiguous timestamp strings without an explicit offset are treated as invalid, preventing host-timezone parsing during hydration. Date-only ISO keys remain deterministic; hold inputs use the explicit Dubai conversion.
- Corrected Dubai day filtering and hold-input semantics as part of making displayed dates consistent.

## Verification and limits

- 239 Inventory tests passed, including name mapping and fallback, role restrictions, Dubai conversion, midnight/year rollover, invalid dates, host timezone changes, reports and disposable SQL tests.
- No connected database, RLS grants, migrations or stored rows changed.
- Production-only `Unknown` case has not been reproduced against the user's real record/account. Physical phones and real notification delivery have not been tested.
- The same-manager name regression uses the mocked signed-in Supabase client; a live phone/desktop session or production RLS comparison was not performed.
- Chromium mobile preview passes at 360, 390 and 430 px for Overview, product detail, Movements and Requests, with the browser set to America/New_York. Named/unnamed people, Dubai timestamps, midnight rollover, no page overflow, manager-only Overview lists and no hydration errors were checked.
- Unit rendering tests cover Inventory timestamps/names in the bell, received notifications and sent notifications. Real notification delivery and signed-in notifications pages on physical devices were not exercised.
- Independent read-only review found one Excel timestamp-format mismatch; it was fixed with a failing/passing workbook assertion. Follow-up review found no important defects.
- An initial parallel verification rerun lost a test worker and stalled; the complete sequential rerun passes all 239 checks. A new notification rendering fixture was corrected to match the existing tab state order.
- Final typecheck and Inventory lint passed (exit 0). Full unrelated repository tests were not run.
- Repository-wide lint completed with 5 pre-existing `react-hooks/set-state-in-effect` errors and 39 warnings. Errors are in unchanged effect code in `components/notifications/notification-bell.tsx` (two), `components/notifications/notifications-page-content.tsx`, `components/notifications/notifications-tabs.tsx`, and `components/ui/resolved-avatar.tsx`. These are the existing failures recorded in Tasks 10a/11; this task adds no lint errors. Full output: `artifacts/task-12-repository-lint.log`.
- Evidence: `artifacts/task-12-tests-final.log`, `artifacts/task-12-typecheck-final.log`, `artifacts/task-12-inventory-lint-final.log`, `artifacts/task-12-browser-results.json` and the mobile screenshots below.
- The local preview server was stopped after mobile verification to release memory for final checks; it can be started again with `npm run dev`.

## Files changed

- `app/dev/inventory-preview/page.tsx`
- `app/inventory/page.tsx`
- `artifacts/task-12-browser-results.json`
- `artifacts/task-12-mobile-check.mjs`
- `components/inventory/movement-request-form.tsx`
- `components/inventory/movements-view.tsx`
- `components/inventory/overview-view.tsx`
- `components/inventory/pending-product-requests.tsx`
- `components/inventory/product-detail-view.tsx`
- `components/inventory/product-reservations.tsx`
- `components/inventory/requests-view.tsx`
- `components/notifications/notification-bell.tsx`
- `components/notifications/notifications-page-content.tsx`
- `components/notifications/notifications-tabs.tsx`
- `docs/superpowers/plans/2026-10-26-inventory-names-dubai-time.md`
- `docs/task-12-names-and-dubai-time-report.md`
- `lib/inventory/date-time.test.mts`
- `lib/inventory/date-time.ts`
- `lib/inventory/manager-movements.test.mts`
- `lib/inventory/movement-history.ts`
- `lib/inventory/notification-presentation.test.mts`
- `lib/inventory/notification-presentation.ts`
- `lib/inventory/presentation.ts`
- `lib/inventory/preview-data.ts`
- `lib/inventory/queries.test.mts`
- `lib/inventory/queries.ts`
- `lib/inventory/reports/format.ts`
- `lib/inventory/reports/movements-report.ts`
- `lib/inventory/reports/reports.test.mts`
- `lib/inventory/types.ts`
- `lib/inventory/ui.test.mts`

Mobile screenshots: `artifacts/task-12-{overview,detail,movements,requests}-{360,390,430}.png` (12 files). Unrelated existing workspace files were left alone.
