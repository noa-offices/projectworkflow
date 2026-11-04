# Project commercial snapshot: Step B study

Source audit on 2026-11-04, on the Step A working branch based on `059f2f3`. This is a design study, not an implemented snapshot migration or proof of deployed database behavior. Follow [MODULE_ROUTER.md](MODULE_ROUTER.md), [OTHER_MODULES.md](OTHER_MODULES.md), and [QUOTATIONS.md](QUOTATIONS.md) for entry points. Line references identify inspected source, and can move with subsequent changes.

The audit read the Project/procurement entry points and their quotation document dependencies, plus `supabase/migrations/`. It did not read `artifacts/`, `docs/colan/`, `scripts/`, or `supabase/maintenance/`; no database or network access was used. The only Step B output is this report. Step A implementation is separate.

## Current contract and conclusion

For Step A, a quotation is locked only when `projectFileFromLayoutSettings(quotation.layout_settings)` returns a valid ProjectFile record. Approval status alone, or an approval draft's `confirmedOrder`, does not establish that lock. Some existing Project/procurement/payment readers still use those older status/fallback rules; this study records that behavior rather than adopting it as the future creation rule.

Projects currently have a small identity/contract-total snapshot inside quotation layout JSON, but their line items, commercial breakdown, payment terms, pricing rules and document generation still depend on quotation data. Adding independent snapshot tables alone would leave these readers unchanged. Removing the old source or allowing quotation changes before switching readers would cause missing Projects, changing vendor groups, and inconsistent contract/document totals.

## Reader inventory

| File and evidence | What it reads | Effect of an independent Project snapshot |
| --- | --- | --- |
| `app/projects/orders/page.tsx:38`, `:53` | Quotation layout ProjectFile or legacy confirmed-order fallback, saved total/currency, pricing rule, cancellation/completion flags; client-name lookup. | Retarget Project lookup and commercial summary. Otherwise still dependent on quotation JSON. |
| `app/projects/completed/page.tsx:38`, `:53` | Same source for completed Projects and completion date. | Retarget; preserve completed execution state independently. |
| `app/procurement/orders/page.tsx:50`, `:65` | Same quotation JSON identity, amounts, pricing and lifecycle. | Retarget active procurement folder listing. |
| `app/procurement/completed/page.tsx:58`, `:84` | Same source for completed procurement folders. | Retarget completed listing. |
| `app/projects/orders/[orderNo]/page.tsx:115`, `:147` | Finds Project through a `client_confirmed` quotation query limited to 200 rows. Reads live quotation totals/VAT/discounts/terms/notes/layout and active quotation items: identity, names/codes, brands, suppliers, sizes/finishes, quantities, units, prices/totals, currency, ordering and style. | Must replace both Project lookup and commercial/item source. Existing detail can disappear after a status change even when valid ProjectFile JSON remains. |
| Same `:159`, `:185`, `:198`, `:212`, `:466`, `:482`, `:669` | Attachments/progress use order number. Lifecycle flags use quotation layout. Schedule lookup uses quotation ID plus order number. Visible subtotal/VAT/grand total use live quotation values; payment contract uses ProjectFile total; payment terms remain live. | Preserve stable order/source identifiers while switching commercial source and lifecycle ownership. Retarget payment context as well as display. |
| `app/procurement/orders/[orderNo]/page.tsx:80`, `:109`, `:159` | Quotation layout determines Project/pricing. Active quotation items determine vendor keys, group labels, quantities, currency, group totals, and PO input. | Retarget both lookup and items. Otherwise quote edits can regroup operational vendor folders. |
| `app/procurement/completed/[orderNo]/page.tsx:87`, `:121` | Same live item dependency for completed procurement, plus completion flag in quotation layout. | Retarget; completed folders are not currently historical item snapshots. |
| `app/clients/projects/[id]/page.tsx:437` | CRM Project folder's quotation list reads quotation numbers/revisions/title/date/status/currency/grand total/layout. | Can remain quotation-backed when intentionally displaying current quotations. Distinguish this list from the frozen Project contract. |
| `components/projects/client-payment-panel.tsx:137`, `:211`, `:524` | Receives contract total/currency and live quotation payment terms from parent; passes quotation ID/order/total to actions. No direct quotation query. | Rendering can retain prop shape, but pass snapshot terms and migrate/preserve action ownership deliberately. |
| `lib/projects/client-payment-actions.ts:74`, `:103`, `:121`, `:134`, `:171` | RPC wrappers for schedules/installments/receipts, passing quotation/order/contract total. | Retarget SQL context and identifiers; adding a frontend snapshot alone is insufficient. |
| `lib/projects/client-payment-attachment-actions.ts:61`, `:87`, `:123`, `:149`, `:164` | Attachment context/metadata RPCs using receipt and quotation/order ownership. | Preserve receipt ownership relationships while migrating Project identity. |
| `lib/projects/mark-project-completed-action.ts:20`, `:36`; `cancel-project-action.ts:19`, `:41`; `reopen-project-action.ts:23`, `:38` | Read and update operational state in quotation layout JSON. | These are lifecycle writers rather than commercial display readers, but must move with Project ownership to prevent state divergence. |
| `components/procurement/vendor-card.tsx:77`, `:178`, `:184`, `:191` | Receives live-derived items, sends them to PO generation, links to quotation RFQ/delivery-note/PO routes. | Pass snapshot items and a Project document context. |
| `lib/procurement/generate-po-action.ts:97` | Inserts caller-supplied limited `items_snapshot` with order/quotation/vendor identifiers. Does not reload quotation items. | Resolve/validate Project snapshot items server-side in a future design; existing issued PO snapshot is useful but incomplete. |
| `lib/quotations/derived-document-data.ts:481`, `:485`, `:516`, `:524` | Shared loader reads live commercial quotation header/layout, client/project contacts, active sections and full active line/specification/image/source-component data. | Main adaptation point for Project documents. Keep quotation-origin rendering distinct from frozen Project-origin rendering. |
| `app/quotations/[id]/purchase-order/page.tsx:57`, `:112` | Shared loader feeds vendor grouping/items, prices/currency, reference/title, client/project display and payment terms; separate PO settings. | Needs Project snapshot context for Project-issued POs. |
| `app/quotations/[id]/procurement-rfq/page.tsx:66`, `:104` | Shared loader supplies items/groups, dates/reference and project/client contacts. | Needs Project snapshot context for procurement-issued RFQs. |
| `app/quotations/[id]/order-confirmation/page.tsx:58`, `:104` | Shared loader supplies confirmation content and quotation delivery/payment terms. Project detail links here at `app/projects/orders/[orderNo]/page.tsx:685`. | Project-issued confirmation must use frozen contract data. |
| `app/quotations/[id]/delivery-note/page.tsx:33`, `:63` | Shared loader supplies delivery note items and document defaults; linked from vendor card. | Project delivery documents must use Project items. |
| `app/quotations/[id]/download-purchase-order/route.ts:60`, `:83` | Loads live shared data/settings and prints quotation PO page. | Change both loader and print URL/context. |
| `app/quotations/[id]/download-procurement-rfq/route.ts:54`, `:81` | Same live loader and quotation print route dependency. | Change both loader and rendering context. |
| `app/quotations/[id]/download-order-confirmation/route.ts:63`, `:80` | Reads quotation metadata directly and prints quotation confirmation page. | Retarget metadata and render context together. |
| `app/quotations/[id]/download-delivery-note/route.ts:52`, `:69` | Loads live shared data for naming/content and prints quotation delivery-note page. | Retarget naming and print context. |
| `lib/quotations/purchase-order-settings-store.ts:98`, `:107`, `:148`, `:181` | Loads `quotation_purchase_orders` settings by quotation ID; save verifies quotation existence. | Project-issued document settings/instances need Project ownership. This table is separate from `project_purchase_orders.items_snapshot`. |

`components/projects/active-projects-table.tsx`, `completed-projects-table.tsx`, `project-file-responsive-layout.tsx`, and `components/procurement/procurement-orders-table.tsx` consume page-provided commercial props rather than querying quotation tables. Their adapters need snapshot-backed props, not independent database query changes. Pure document pagination/render helpers similarly consume supplied data. `lib/procurement/procurement-summary.ts:114` reads PO/progress identifiers and deliberately excludes item snapshots/prices; stable identifiers can preserve this behavior.

## Database findings: migrations only

No migration-defined post-approval/Project-created mutation lock on `quotations`, `quotation_items` or `quotation_sections` was found. This does not establish what is installed in a deployed database, and maintenance SQL was intentionally excluded.

| Migration evidence | Finding |
| --- | --- |
| `008_quotations.sql:193`, `:201`, `:229`, `:237`, `:265`, `:273` | INSERT/UPDATE policies depend on record-manager role, without approval or ProjectFile predicates. |
| `026_archive_permanent_delete_policies.sql:19`, `:27`, `:43` | DELETE policies for quotation/sections/items are role-based; no commercial freeze. |
| `081_sales_coordinator_role.sql:26`, `:52`, `:59`, `:66`, `:73`, `:88` | Additional sales-coordinator policies cover these tables and are role-based, not approval-aware. |
| `008_quotations.sql:149`, `:156`, `:163`; `053_client_project_numbering.sql:187` | Existing triggers update timestamps and assign quotation numbers; these do not protect approved content. |
| `20261001093911_local_builder_atomic_publication.sql:16`, `:37`, `:39`, `:154`, `:204`, `:242` | Version triggers and parent row locking serialize publication and detect stale versions. Publication still replaces active sections/items and updates commercial header. This is concurrency protection, not approval immutability. |
| `083_sales_approval_snapshots.sql:58`, `:74`, `:138`, `:143`, `:155` | Captures first appearance of Project/legacy order metadata, checks attribution/metadata, then makes the sales snapshot immutable. Does not freeze quotation header or items. Sales snapshot contains commercial-value evidence, not a full execution line snapshot. |
| `092_client_payment_contract_total_guard.sql:20`, `:31`, `:55`, `:67` | Payment context requires active `client_confirmed` quotation, accepts Project/legacy JSON paths, validates Project total, and reads quotation lifecycle/currency. It guards payment operation context, not quotation writes. Must retarget for independent Project ownership. |
| `065_project_purchase_orders.sql:2`, `:5`, `:10`, `:18` | Existing issued PO rows store limited JSON item snapshots; grants/policies allow authenticated procurement SELECT/INSERT. Quotation FK is `ON DELETE CASCADE`; independent history must not disappear with source deletion. |
| `089_client_payment_schedule.sql:56`, `:61` | Payment schedule quotation FK is restricted and unique per quotation. Preserve existing schedules/receipts and map ownership explicitly rather than recreating them. |

### Future database guard scope and allowances

A future database guard should evaluate the persisted old ProjectFile using the same validity contract as the application parser, not merely a non-empty order number, approval status, or legacy confirmed-order presence. Protect commercial quotation header/layout and child items/sections against UPDATE/DELETE and new child INSERT after that lock. Moving a child must check both old and new quotation parents. Publication RPCs and security-definer writers must remain subject to equivalent protection; adding another permissive RLS policy is not an effective deny rule.

Allow explicitly reviewed operational changes: cancellation/completion/reopening metadata, allowed lifecycle status transitions/notes, and salesperson/approved-salesperson attribution where existing business workflows require them. Validate layout replacements by comparing protected content; allowing the entire layout JSON because one operational field changes would bypass the freeze. Do not allow protected ProjectFile identity/total or pricing changes through an operational exception. Existing attribution/sales-ledger trigger requirements still apply.

New revision/option/enquiry INSERTs must remain possible and copy commercial content into a new unlocked quotation while preserving the locked source. Read/print/export must remain available. Independent execution records, payment receipts, vendor documents/progress and issued-document settings need their own authorization rules rather than a broad quotation commercial-write exemption. This study does not authorize or implement these future triggers.

## Proposed snapshot shape

Use a stable Project execution UUID and unique order number, retaining the existing CRM `project_id` where present. Source quotation ID/number/revision and workspace version are provenance; avoid cascade deletion of frozen commercial history when its source quotation is deleted. A restrict or deliberately nullable provenance relation requires a separate lifecycle decision.

Store one immutable commercial snapshot header per Project with schema version, captured-at/by, source identifiers/version, original valid ProjectFile metadata, client/project/contact display snapshot, currency, pricing/rounding rules, subtotal, discounts, VAT rate/amount, quoted grand total, and a separate authoritative Project contract total. The latter can differ due to existing rounding policy and must not be silently replaced by live quotation grand total. Include payment/delivery/warranty/validity terms and notes.

Store snapshot sections and items owned by that snapshot, using stable snapshot IDs plus original row IDs for provenance. Preserve section hierarchy and item parent references through explicit remapping. Include quantity/unit, unit/net price and totals, discounts, currency, costing/margin/source-component information required by current documents, supplier/brand keys and labels, codes/names/specifications/finishes/options/images, optional/include-in-total/rate-only/style flags, and ordering/document layout. Copy full relevant row data rather than relying on the smaller existing PO snapshot.

Keep mutable execution state outside the frozen commercial snapshot. Attach payment schedules, procurement groups, progress/documents and issued POs/document instances to stable Project identity. Preserve current order-number keys during transition. Retain existing issued PO snapshots as issued-history evidence; they are not an authoritative complete Project commercial snapshot.

## Idempotent one-time copy proposal

1. Select records accepted by `projectFileFromLayoutSettings(layout_settings)` only, regardless of approval status. Inventory malformed ProjectFile JSON and legacy-only confirmed orders separately; do not silently qualify them through fallback logic.
2. Use a consistent transactional read boundary for each source/header/sections/items/settings copy. Copy the valid ProjectFile plus the then-current commercial quotation data and necessary document settings. Preserve order/source IDs and existing payment/document/progress associations.
3. Enforce unique Project order/source identity and stable snapshot capture identity so reruns cannot duplicate or overwrite existing frozen snapshots. Report duplicate order numbers, source metadata mismatches, missing references, count discrepancies, currency issues, and quoted-total versus contract-total differences before cutover.
4. Record migration provenance explicitly: existing line data is captured from the current quotation at migration time. It cannot reliably reconstruct original approval-time line values after intervening edits; sales-value snapshots and issued PO snapshots provide partial evidence only. Do not label such copies as proven approval-time snapshots.
5. Verify item/section counts, remapped relationships, vendor keys, displayed commercial breakdown, authoritative payment total and document output against source reads. Switch Project/procurement/payment/Project-document readers and operational writers together. Keep quotation-origin documents rendering their own quotation data.
6. Maintain existing RLS boundaries for commercial data, payments, costs and procurement; copying data to new tables must not broaden read permissions. Define snapshot immutability, controlled capture permissions and backfill retry behavior before implementing any migration.

No SQL, schema migration, database trigger, Project/payment code change or snapshot backfill is implemented by this Step B report.

## Write paths that bypass the application lock

Step A guards the server actions, the local-builder publish route, client merge and the delete cascades. These paths do not go through that guard, so only a database guard would cover them:

- Direct table writes by any signed-in records manager. The RLS policies are role-based, so a request sent straight to the Supabase API can update or delete `quotations`, `quotation_items` and `quotation_sections` without calling an action.
- `public.publish_local_builder_workspace` is `security invoker` and granted to `authenticated`. The lock check lives only in `app/api/quotations/[id]/local-workspace/route.ts`; calling the RPC directly skips it.
- Service-role (admin) clients ignore RLS: the Project cascade delete in `app/clients/actions.ts` (`deleteQuotationsByIds`), client merge in `app/sales/clients/actions.ts`, and `lib/projects/reopen-project-action.ts`. The first two now check the lock first; the third only writes lifecycle keys.
- Database internals that update `quotations` (numbering in `053_client_project_numbering.sql`, attribution in `082_approval_sales_manager_attribution.sql`) and anything under `supabase/maintenance/`, which this audit did not read.
- Actions left open on purpose because they are Project work or create the lock: `createProjectFileFromQuotation`, `createConfirmedOrderFromApproval`, `updateQuotationSalesperson` (attribution only), price-history inserts, payment/receipt/attachment wrappers (they write payment tables, not the quotation), and the cancel, complete and reopen actions (lifecycle keys only).
