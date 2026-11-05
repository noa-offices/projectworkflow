# D2 commission variation adjustments

## Design and migration

Migration: `supabase/migrations/20261110100000_sales_commission_adjustments.sql`. Review and apply separately; this work does not apply it to a live database. It performs DDL only, with no backfill or data writes during installation.

New objects:

- `sales_commission_adjustments`: signed ledger, unique applied variation, RESTRICT parent/variation foreign keys, copied parent formula/basis/rate/fixed/tier/currency, cumulative bases and entitlements, review reason, workflow actors/timestamps. Unresolved amounts remain NULL rather than a misleading zero.
- Parent index and SELECT RLS policy: visibility comes from the original commission's RLS. Authenticated clients receive SELECT only; anon and service_role receive no table grants. No direct client writes.
- `generate_sales_commission_adjustment(uuid)`: SECURITY DEFINER, empty search path, System Owner only for explicit calls. Serializes on the immutable variation row; existing non-review rows return unchanged. Only requires_review rows may recalculate, with financial-editor tracking. The trusted insert trigger can call this same function; clients cannot insert variations or execute the trigger function.
- `sales_commission_adjustment_after_variation()` and `sales_commission_adjustment_on_variation`: new AFTER INSERT hook on `project_variations`. Generation has its own exception subtransaction. Failure is audited and application continues. If the audit itself fails, a database warning is the final fallback; no audit mechanism can guarantee persistence while its own writes fail.
- `transition_sales_commission_adjustment(uuid,text,text)`: guarded submit, return, approve, cancel, paid and reverse; same roles, transitions, required reasons and error wording as 085. Another active System Owner approves; submitter and last financial editor cannot approve. Negative credits need approval too. Workflow audits and notifications link to the parent detail page.
- `guard_sales_commission_adjustment()` plus update/delete/truncate triggers: immutable identity, protected financial values and no history deletion. Approved/paid rows cannot move back to editable states.

Calculation calls the existing SQL calculator twice with the parent's copied values: **new cumulative entitlement minus previous cumulative entitlement**. A slab crossing from 1,000 at 10% to 2,500 at 20% is +400, not 1,500 × 20% = 300. Fixed fee alone normally gives zero.

VAT-inclusive bases use original approval `source_total`, then each variation's `new_contract_total`. VAT-exclusive V1 uses approval `amount_excluding_vat`; later previous bases use the preceding applied variation's `new_contract_total - vat_amount`. The new base is the current variation's `new_contract_total - vat_amount`. Each VAT is for the full scope. This matches 083's source-total-minus-VAT definition, including the legacy ceil-to-5 contract rounding; no formula correction was needed. No saved quotation is recalculated.

Missing parent: no row plus audit, because a genuine parent FK is required. Missing/invalid necessary bases, currency mismatch, missing copied rule, cancelled/reversed/review parent or manual override: requires_review. Users cannot type financial values. Recheck only succeeds when the upstream issue is resolved; immutable missing VAT and override-policy issues may require a later explicit policy. Zero: audit only. If an existing review row resolves to zero, retain it as cancelled history rather than delete it. This is the only addition to the requested zero-row policy.

## Pages and totals

- Commission detail: original amount, approved/paid adjustments and net; V number, status, signed amount, review reason, workflow controls, and “Amount to recover” for a negative credit against a paid parent. Adjustment audits join the existing history. Drafts, review, pending, cancelled and reversed adjustments do not enter net. The original amount retains its original status, including if cancelled/reversed; this is a ledger comparison, not a payable balance.
- Commission list: original totals and status cards stay original, explicitly labelled by explanatory text; “+ adjustments” links to detail. This is a known limit rather than combining independent adjustment statuses under the parent's status filter.
- Personal profile commission cards: status counts include linked adjustments. Earned adds approved/paid adjustments only; Paid and Approved Not Paid use each adjustment's own status and signed amount, per currency. The table stays original records. Period selection follows the original commission's earned date, as before: a recent adjustment for an original commission outside that period is not included. Use parent detail for its full history.
- NOA: targeted search found no query of `sales_commissions` or commission-amount/status aggregation in `lib/noa`; sales totals are contract values, not commissions. No NOA routing, wording, aliases or totals were changed.

Before SQL installation, new reads fail safely: detail reports unavailable net, list reports unavailable adjustments, profile cards explicitly show original-only values. New actions need the migration. Installing SQL first starts automatic drafts immediately, even with the old UI; deploying code afterwards exposes them. Historical variations get no automatic rows. An active System Owner may explicitly call `generate_sales_commission_adjustment(variation_id)` to generate/recheck one historical variation at a time.

## Protected scope

No existing function is recreated (diff: none). Existing `sales_commissions` table/functions/triggers, calculator, original generator, approval snapshots and trigger, variation application and existing variation objects, Project snapshots, payment code/tables/functions, Project File records, quotation lock, pricing rules, supplier matching and price history are unchanged. The only hook on existing storage is the explicitly requested new AFTER INSERT trigger. No migration is applied live. No other worktree or user-owned untracked folder is touched.

## Verification

Local PGlite uses the existing snapshot test fixture and actual 084/085/086, Project snapshot and variation migrations. Tests exercise generation, tier crossings, fixed/zero, both VAT bases, whole and legacy values, negative credits, V1/V2, missing inputs/parent, overrides, idempotency and direct unique constraints. Real `apply_project_variation` is called both normally and with an injected ledger failure; application succeeds and the failure is audited. Database function text is checked unchanged. RLS, grants, wrong-role/self approval, reasons and protected approved/paid values are tested. Pure tests cover approved-only net, profile currency/status totals and batched caller-scoped loading. Server-action tests reject financial input forwarding; rendered controls cover credits, review, unavailable schema and maker-checker visibility.

Final validation: 12 focused tests passed; changed-file ESLint passed without warnings; app TypeScript check passed using the project configuration with only user-owned protected folders excluded and incremental output disabled. `git diff --check` passed. There were no failing checks to compare with main. Unrelated known failing suites were not rerun, following the focused-test instruction. React review checked server-action authentication, RLS-backed reads, maker-checker button visibility, reason labels and status-aware sums. No live browser/database integration test was run; render tests and real SQL execution in PGlite provide local evidence only. The migration still needs the owner's SQL review and application. Branch: `feature/commission-variation-adjustments`; commit is recorded in the delivery report.
