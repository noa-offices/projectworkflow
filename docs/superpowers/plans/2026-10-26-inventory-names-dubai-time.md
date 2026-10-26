# Inventory names and Dubai time implementation plan

**Goal:** Task 12: safe full names and consistent Asia/Dubai dates throughout Inventory.
**Architecture:** Reuse signed-in `displayNames` and the complete Movements enrichment path. Share Intl-based Dubai conversion with reports, expiry inputs and date filters. Add manager-only Overview activity without costs or new profile access.
**Constraints:** Existing PW components; no dependencies; no database changes; no email fallback; 360/390/430 px; deterministic hydration.

- [x] Add regression tests for Dubai conversion, rollover, invalid dates and environment-independent rendering.
- [x] Centralize time formatting and report/input/filter conversions without a fixed UTC offset.
- [x] Test and share product movement enrichment and safe full-name presentation.
- [x] Add bounded manager Overview pending/recent lists using existing safe reads, test roles and mapping.
- [x] Update Inventory notification timestamps and names without changing unrelated notifications.
- [x] Run Inventory tests, typecheck, scoped/full lint and mobile overflow checks; write report and request independent review.
