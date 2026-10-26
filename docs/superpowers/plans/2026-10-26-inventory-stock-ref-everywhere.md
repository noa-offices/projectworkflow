# Inventory Stock ref everywhere

Goal: Task 14. Use one identifier formatter on Inventory cards, rows, details, forms, pickers and reports. Stock ref first, then populated Code/Model; unapproved new items say `Ref assigned on approval`.

Constraints: existing PW UI, no dependencies, no access/cost changes; mobile 360/390/430. No database read-function changes. Notification trigger formatting requires one unapplied migration; do not apply SQL. Historical notifications cannot safely be backfilled without an item/request identifier.

- [x] Add failing helper, request/reservation/Overview and mapping tests.
- [x] Implement the shared formatter and use it on Inventory screens, pickers and forms.
- [x] Carry product identifiers in Overview and per-product pending requests/reservations using existing signed-in reads.
- [x] Keep Stock ref as a dedicated report column and add the identifier line beneath report item names; preserve search matching.
- [x] Prepare unapplied notification-format migration with rollback-only offline assertions.
- [x] Run Inventory tests, typecheck, lint, mobile checks and independent review; finish report with every checked screen and limits.
