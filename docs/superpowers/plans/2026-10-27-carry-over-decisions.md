# Supplier review decision carry-over implementation plan

**Goal:** Let managers review earlier decisions when a new version of the same brand's supplier list is uploaded, without saving or applying anything automatically.
**Architecture:** A read-only, manager-gated RPC returns latest open decisions by code/field from other source versions of the same brand. A pure helper classifies each current check row against current-source saves and earlier candidates. The dialog pre-fills compatible candidates as local unsaved edits and keeps the existing explicit Save flow.
**Spec:** Task 19c attachment, 27 October 2026.

- [ ] Create one unapplied migration for `list_carry_over_decisions(uuid)` and rollback SQL tests. Assert all roles, source/brand boundaries, status, latest winner, names and 5000 limit in disposable PostgreSQL.
- [ ] Add helper and tests for saved/carried/changed/new, 4-decimal numeric comparison, null/zero, currency, unusable supplier, duplicates and winner ordering.
- [ ] Wire manager-only RPC action, load with current saves in footer and dialog, pre-fill local changes, tags/tooltips, chips, counts and CSV provenance. Add component/browser tests, including no selected rows.
- [ ] Verify focused tests, typecheck, lint, browser at 1440/1024/390, products suite once, independent review; commit/push branch without merge.

Rulings: a current-source record wins even if cancelled/applied; only an open current-source decision counts as decided. Earlier source versions may be archived because a new upload can supersede them. The RPC limits after choosing the latest row per code/field and orders returned keys deterministically. A cleared carry suggestion becomes Not decided locally and is not written. CSV marks carried suggestions with their source but reflects saved/manual edits only after explicit Save. The base branch is the pushed Task 19b branch because it is not merged into main.
