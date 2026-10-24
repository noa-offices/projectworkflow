# Inventory stock references

Implement Task 7d from merged main `bf07907` on `phase-7d/stock-ref`.

- [x] Add the requested transactional migration: per-brand internal counters, references allocated only on approval/direct add, nullable item code/model, and blank normalization. Preserve existing records, audit, costs and stock behavior.
- [x] Remove stock-ref input, make item code/model optional, and preserve generated references on product detail after manager navigation.
- [x] Make product/request types, mapping, displays, search and previews handle nullable fields using an em dash.
- [x] Run the requested self-undoing SQL tests in disposable PGlite, unit tests, inventory lint and typecheck; review the complete change and open one short, generic PR.

No live database access or service-role client. The user will apply migrations after review. Counter updates and approval must share one transaction; rejected and failed requests must not consume a number. Counters skip active legacy references and must grow past four digits without truncating.

SQL and presentation work have separate file ownership; application validation and forms are implemented in the coordinating session.

Verification: 96 inventory tests passed, including all SQL assertions in disposable PGlite; TypeScript and inventory lint passed. Offline 390px browser checks submitted items without item code/model, verified no stock-reference input or payload, manager navigation and generated reference display, em-dash placeholders, warehouse pending confirmation, and no overflow/browser exceptions. Independent review found no Important or Critical issues. Live deployment and concurrent multi-connection behavior were not exercised.
