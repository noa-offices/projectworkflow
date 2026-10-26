# Inventory brands implementation plan

**Goal:** Implement Task 10a using the supplied specification and existing Inventory UI.
**Architecture:** Nullable public/local identities; separate Inventory-only counters; role-checked RPC access to local brands. Keep public.brands and existing refs/counters untouched.
**Constraints:** No database migration application; no dependencies; same PW UI at 360/390/430px; costs unchanged.

- [x] Add rollback SQL contract and offline harness, and failing identity/picker tests.
- [x] Add one migration: local brands, constraints, protected read/manage RPCs, counters, and updated request/review/edit functions.
- [x] Update typed identities, validation, reads/search, shared picker, filters and report labels.
- [x] Run offline SQL tests, unit/UI suite, typecheck, lint and mobile browser checks; report limitations and decisions.

Review focus: inactive historical labels, cross-kind edits, collision skipping, nonmanager access, no-brand filters distinct from all brands.
