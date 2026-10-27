# Supplier price review decisions implementation plan

**Goal:** Save manager decisions separately from the read-only supplier check. No product, draft, Apply, or live database changes.
**Architecture:** Reuse the check's source version ID, manager cost-access policy, CSV guard, and Dubai formatter. Store a single current decision per source/code/price field through checked RPCs. Keep local edits until explicit Save.
**Spec:** Task 19b supplied in the attached request, 26 October 2026.

- [x] Database: one unapplied migration, strict JSON validation and manager gates, name-only listing, rollback SQL contract and combined TEST file. Exercised only in disposable PGlite.
- [x] Helpers/server actions: validation, stale snapshots, role gates, CSV. Focused tests passed after observed RED.
- [x] Dialog: manager actions, selection, filters, explicit save/close confirmation, responsive cards, footer count. Static and browser checks passed.
- [ ] Verify: focused tests/lint, typecheck, products suite once, screenshots at 1440/1024/390, independent security review, commit/push without merge.

Implementation rulings:
- `supplier_source_id` is `source.versionId`, the actual checked price list version.
- Not decided cancels an existing decision; new undecided rows need no stored record. Cancelled records preserve the last valid decision and stay outside decided filters.
- The required unique key excludes category. Conflicting duplicate keys must be blocked explicitly rather than silently overwrite one another.
- Save in batches of at most 200, recording each successful batch so a later failure preserves only remaining unsaved edits.
- The detailed user specification authorizes implementation in the requested branch; work stays in this checkout to preserve the installed environment and unrelated untracked files.
- Currency remains the imported amount's currency. Usable supplier amounts already agree; ambiguous/mismatched supplier amounts are null.
- CSV contains saved decisions; exporting while loading/after load failure is blocked. Conflicting duplicate keys export as Not decided even if a conflicting row is filtered out.
- Manager rows use 50-row pages so expanded notes do not break fixed-height virtualization. All filtered rows can still be selected and exported. Below 1280 px managers see one/two-column cards.
- Concurrent manager saves use last-write-wins upsert, matching the requested one-current-decision contract. Future application semantics are outside this task.

Verification ledger:
- 33 focused tests pass (helpers, static components, server role/RPC boundaries, disposable PostgreSQL rollback contract).
- Browser fixture: six scenario groups pass, zero browser errors; three requested widths captured and visually inspected. No live database calls.
- Independent read-only review: GPT-6 Astra, High. Four findings fixed with regressions: imported currency, conflicting-key CSV, stale note confirmation, export before load.
- Typecheck and lint of touched code passed. Products suite and branch push recorded in the Task 19b report.
