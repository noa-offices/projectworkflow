# Inventory privacy and clear history implementation plan

Goal: Managers retain full inventory visibility; other roles see only their requests, no movement history or other names. Finished requests can be hidden and restored without deletion.
Architecture: Enforce ownership in RLS and privileged name functions, retain signed-in clients. Manager-only RPCs archive/restore; list queries filter archives, never RLS. Reuse existing dialogs and Dubai date helpers.
Spec: User Task 20 attachment (2026-10-28). No migration is applied. Work only in this worktree. Keep warehouse routing and reservations.

- [x] Database: audit inventory/public functions and views; prepare one migration with three SELECT policies, restricted person_names, archive columns/constraints and manager RPCs with least-privilege grants. Add rollback-only before/after SQL tests across every role, request type/status, ownership, cutoff, attribution and unchanged stock. Record reservations exposure proposal.
- [x] App query/actions: enforce own request reads and manager movements, archive filters and counts, manager server actions with revalidation; audit notifications/profile/reports/routes/products.
- [x] UI: manager clear dialog with read-only counts, scope/age choices, show-cleared toggle, metadata and individual/bulk restore. Non-manager My requests and no movements/names. Tests first, using real helper/render behavior.
- [x] Verify: inventory tests plus touched tests, typecheck, lint touched files, isolated SQL emulator tests where available, screenshots at 1440/390 using synthetic preview fixtures. Review security changes independently. Push branch without merge.

Review focus: forged role/query inputs; disabled/pending/no-profile callers; count and mutation scope drift; pending rows and concurrent clear calls; archive metadata reaching non-managers. Fail closed server checks and database checks cover these.
