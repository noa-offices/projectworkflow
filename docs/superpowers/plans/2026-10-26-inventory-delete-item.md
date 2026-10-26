# Task 11 implementation plan

**Goal:** Separate permanent Inventory deletion from unchanged archive removal; migration remains unapplied.
**Architecture:** Explicit, role-checked transactional SQL cleanup of the six product foreign keys and request costs/images; collect exclusive Storage paths before deleting rows. A manager-only summary RPC supplies current counts/reference. The server confirms the reference, deletes database rows first, then removes each Storage object and reports/logs leftovers. Existing PW modal, manager tools and Products status banner handle confirmation/result.

Foreign key audit: product_costs.product_id (CASCADE), product_images.product_id (CASCADE), product_requests.approved_product_id (SET NULL), movements.product_id (RESTRICT), movement_requests.product_id (RESTRICT), reservations.product_id (RESTRICT). Secondary links: product_request_costs/product_images -> product_requests; movement_requests -> movements/reservations; reservations -> movement_requests/movements. No delete notification triggers exist (only INSERT and request_status UPDATE).

- [x] Add failing SQL/action/UI contract tests, including roles, archived items, untouched other data and counters.
- [x] Add one unapplied migration with manager-only summary and permanent delete RPCs, explicit foreign-key handling and no notification/counter/public-table writes.
- [x] Add server action, exclusive Storage cleanup, typed-ref dialog, archived manager tool and Products result banner.
- [x] Run all Inventory tests, typecheck, scoped lint, independent review and mobile preview checks; document limits/decisions.

Decisions: preserve Storage objects still referenced by other items; reject inconsistent cross-item movement/reservation links rather than mutate another item. Ref confirmation is exact and rechecked server-side. Edit screen has no tools menu, so no additional edit menu is introduced.
