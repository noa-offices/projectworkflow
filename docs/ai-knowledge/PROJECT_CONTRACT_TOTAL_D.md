# Project contract total, Step D

Source audit against main `61400e7`. No database or migration was executed. Commission work below is a study only.

## D1 reader and consumers

`lib/projects/project-contract-total.ts` owns `projectContractTotal(originalTotal, state)`, the batched `loadProjectContractTotals(client, quotationIds)`, and small quotation/order adapters. No applied variation, a missing function, a failed batch or unreadable state uses the stored original amount. Applied variation number, current total and cumulative change from original come from the latest valid applied state. IDs are deduplicated, empty reads are skipped, and calls contain at most 50 IDs. The caller's existing client and RLS remain authoritative.

| Consumer | Value now read |
| --- | --- |
| `lib/dashboard/actions.ts` | Active/completed Project values, confirmed sales totals by salesperson, monthly confirmed sales. Variation quotation rows are not counted again as new deals. Existing time ranges remain based on the Project's original quotation date. |
| `app/projects/orders/page.tsx`, `app/projects/completed/page.tsx`, `app/procurement/orders/page.tsx`, `app/procurement/completed/page.tsx` | Current value through the order-number adapter, replacing the older independent variation-total loader. |
| `lib/projects/project-scope.ts` | Uses the pure reader for the current contract value when the latest complete scope is available. Existing scope fallback is preserved. |
| `app/sales/approvals/page.tsx` | Current Project contract value, including a variation quotation linked to its parent Project. Rows with no Project keep their quotation total. |
| `app/insights/sales-report/page.tsx` | Approved Project amounts in KPIs, salesperson ranking and monthly approved series. Quoted amounts and recent quotation rows remain the quotation's own amount. |
| `lib/settings/profile-stats-loader.ts` | Team approved Project values and personal Project approved values. Existing commission rows/commission totals and quotation/preparation amounts remain unchanged. |
| `lib/local-read-cache/server.ts`, `projections.ts` | Current amount is included at server build/refresh. Project/completed saved previews hide money, including old cached rows: an offline snapshot cannot verify whether a later variation changed the contract. Online Project screens show current values. |
| `lib/noa/noa-project-capability.server.ts` | Current Project values; Attention and User Activity reuse this source. |
| `lib/noa/noa-client-capability.server.ts` | Current values for the client's Project summaries. |
| `lib/noa/noa-procurement-capability.server.ts` | Current contract value in procurement Project summaries. Supplier PO/document amounts are separate. |
| `lib/noa/noa-insights-capability.server.ts` | Project/client aggregates, Project payment analytics input and sales-by-salesperson approved values. |

NOA routing, planning, prompts, permission checks and no-variation result shapes are unchanged. V2 tools already delegate to the updated capabilities. `noa-quotation-capability.server.ts` is deliberately unchanged: its totals mean the quotation's own sales document; Project metadata there is used only for lookup. `noa-relation.server.ts` returns identity/links rather than contract money. Quotation pages/lists/PDFs/revisions, payments, variation application, snapshots and Project File records are unchanged. Document scope consumers already use `project-scope.ts`; line values and supplier purchase-order values are not Project contract totals.

## D2 commission study

### (a) Current base and creation

`083_sales_approval_snapshots.sql`, `capture_sales_approval_snapshot`, captures the first Project File or legacy confirmed-order appearance. Its `source_total` is the stored Project/confirmed-order total; `vat_amount` is copied from that metadata; `amount_excluding_vat` is source total minus copied VAT, or null when VAT is unknown. Snapshot date/owner/currency are copied too. Folder uniqueness and the immutable snapshot trigger prevent a second qualification for that folder.

`084_sales_commission_rules_ledger.sql`, `generate_sales_commission_for_snapshot`, runs after snapshot insertion, once per snapshot. It chooses the salesperson's enabled rule effective at qualification time, copies its formula/basis/rate/fixed/tier configuration into `sales_commissions`, and uses either `source_total` or `amount_excluding_vat` according to the copied basis. Missing rule or unverifiable legacy VAT produces `requires_review`. This is not a live Project-total calculation.

### (b) Status and protection

Statuses: draft, requires_review, pending_approval, approved, paid, cancelled, reversed. Only draft/requires_review can be financially recalculated. Draft can be submitted or cancelled; pending approval can be returned to draft, approved or cancelled; approved can be marked paid or reversed; paid can be reversed. Return/cancellation/reversal require a reason. `085_commission_maker_checker_notifications.sql` enforces an active authorized actor, prevents the last financial editor submitting, and requires a different active System Owner from the submitter/financial editor to approve. `086_commission_sales_manager_follow_up.sql` adds follow-up events rather than financial edits.

`app/commissions/actions.ts` calls the guarded RPCs; detail UI exposes financial edits only in draft/requires_review. Authenticated table permissions are SELECT-only with RLS; security-definer workflow/recalculation functions enforce role and status. Unique snapshot identity, nonnegative amount constraints and append audit/workflow records provide additional controls. The approval snapshot is immutable. The ledger's approved/paid financial fields are protected by privileges and RPC status checks, not an immutable-every-column trigger: privileged service-role access remains a trusted administrative boundary. Reversal is a status/history operation, not a negative ledger entry.

### (c) Signed amounts and adjustments

The ledger has no variation/parent-adjustment link or adjustment row kind. Its approved bases, overrides, original amount and final commission are constrained nonnegative. Both the SQL calculator and `lib/commissions/calculation.ts` reject negative basis inputs; the TypeScript parser accepts unsigned decimals only. A negative credit adjustment cannot be recorded through the current supported flow. A second approval snapshot per variation would also conflict with folder uniqueness and would select a rule effective on that new date instead of automatically inheriting the original copied values.

### (d) Variation behavior and divergent displays

`20261108100000_project_variations.sql` stores and applies scope, VAT, grand total, previous/new contract total and delta; it does not create a commission or another sales approval snapshot. The first-appearance snapshot trigger does not fire again when a variation is applied. Original commission financial values therefore remain unchanged.

After D1, the dashboard, sales approvals, approved sales report values, Project profile values and NOA Project/sales aggregates follow the revised contract. Commission list/detail totals, profile commission cards and commission-related activity remain ledger values. Quoted/preparation values remain original quotation values. These are intentionally distinct until a commission adjustment policy is approved.

### (e) Options and recommendation

1. **Separate signed adjustment ledger (recommended).** One adjustment per applied variation, uniquely linked to that variation and its original commission. Copy the original effective formula/rate/basis/tier/fixed configuration, currency, ownership and provenance into the adjustment. Compute the difference between commission entitlement on the revised cumulative basis and entitlement on the prior cumulative basis. Flat percentages reduce to applying the same rate to the basis delta; fixed fees and tiered slabs do not. This avoids paying a fixed fee repeatedly or missing a tier-threshold change. Preserve the original row and every approved/paid amount. Use the same maker-checker lifecycle and explicit signed credit review. A credit records a recoverable/offset amount; it must not silently rewrite a paid commission or receipt. Reversed, cancelled, missing or manually overridden original commissions require review and an explicit policy for overrides.

   For VAT-inclusive rules the basis change is the stored contract delta. For VAT-exclusive rules compare each full scope's contract total less its full VAT against the preceding scope (original snapshot for V1). A variation's `vat_amount`/`grand_total` describe the full revised scope, not the VAT/price delta; do not subtract all of the new VAT from `contract_delta`. Preserve legacy contract rounding differences and require review if prior VAT is unavailable. A schema migration, durable/idempotent generation tied to application, signed calculation/RPCs, approval UI, access controls, ledger/profile/NOA rollups and tests are required. Medium scope; the existing original ledger has less regression exposure.

2. **Extend the existing ledger with original/adjustment entry kinds.** Add parent commission/variation links, signed constraints and uniqueness; preserve the original folder snapshot and use variation-specific provenance rather than pretending each variation is a new original approval. Adapt generation, calculators, every approval/payment/reversal query, totals and exports to signed entries. The same entitlement-difference and VAT rules above apply. It gives one unified ledger/UI, but has a larger migration and regression surface because current consumers assume one nonnegative row per approval. Higher cost and risk than a separate adjustment ledger.

Before either build, decide how approved manual overrides, fixed fees, tier crossings, reversed originals, credit recovery and already-applied variations should be treated. Existing applied variations should produce reviewable backfill proposals only, with unique variation identity and no automatic approval/payment. No commission code, SQL, screen or data was changed in D1.

## Verification

The selected touched-file and NOA golden/safety run contains 306 tests: 298 pass, 8 fail. All eight were rerun against `origin/main` source without switching branches and fail there too (61 of those 69 baseline tests pass):

- `noa-phase-b7-safety.test.mts`: tests 1 (exact auth import), 5 (mutation-pattern assertion) and 15 (old prohibition on salesperson reporting).
- `noa-phase-n2a1-safety.test.mts`: tests 7 and 12 (older permission-gate source patterns), 25 and 26 (older partial-permission state-variable patterns).
- `project-scope.test.mts`: “the Project page and both procurement pages read their lines only through the scope module” still asserts the pre-variation frozen payment-total wiring.

The conversation golden suite and sales-by-salesperson golden checks pass, as do the relevant ERP Project/Client/Procurement safety checks, current-value consumer tests and updated Insights Project/payment analytics harness. Tests exercise a stored contract of 1,000 with no variation and V1 at 1,200 across dashboard, report, approvals, profile, NOA, cache and list adapters; quoted values stay 1,000. Reader tests include latest state, credit, missing/failed state, deduplication and 101 IDs in three calls. No live services were used.

The full type check passes. Changed-file lint has no errors; existing unused-variable warnings remain in dashboard actions (`_daysUntil: _`) and NOA procurement (`_context`), both verified in main. Unrelated product/action suites were not run. Temporary baseline overrides and logs were removed before staging.

Risk: an unavailable variation-state RPC deliberately falls back to the original total, as required; it cannot verify the revised value during that outage. Existing report date, status, currency, attribution, RLS and bounded-scan behavior remain in force. Cached Project money is hidden to avoid presenting stale totals offline. The old `loadRevisedContractTotals` export remains in the untouched variation module for compatibility, but all four application lists now use the shared Step D reader.
