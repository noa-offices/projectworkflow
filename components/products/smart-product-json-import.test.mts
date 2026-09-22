import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/products/smart-product-json-import.tsx", "utf8");
const categoryRenderer = source.slice(
  source.indexOf("function SmartAccessoryRowsEditor"),
  source.indexOf("function SmartScalarAccessoryRowsEditor"),
);
const scalarRenderer = source.slice(
  source.indexOf("function SmartScalarAccessoryRowsEditor"),
  source.indexOf("function PricedRowsEditor"),
);
const directModularRenderer = source.slice(
  source.indexOf("function DirectModularRowsEditor"),
  source.indexOf("function CurrencyField"),
);
const matrixEditorRenderer = source.slice(
  source.indexOf("function MatrixEditor"),
  source.indexOf("function SmartAccessoryRowsEditor"),
);

test("accessory groups use compact category or scalar tables while other pricing rows keep the legacy editor", () => {
  [
    "function LegacyPricedRowsEditor",
    "function SmartAccessoryRowsEditor",
    "function SmartScalarAccessoryRowsEditor",
    "function PricedRowsEditor",
    'props.rowType === "accessory"',
    "Boolean(props.priceCategories?.length)",
    '"prices" in row',
    "priceCategories={group.priceCategories}",
    "if (categoryPriced) return <SmartAccessoryRowsEditor",
    'props.rowType === "accessory" ? <SmartScalarAccessoryRowsEditor',
    ": <LegacyPricedRowsEditor",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected renderer contract: ${expected}`));
});

test("scalar accessory groups render an ordered compact table with editable preserved prices", () => {
  [
    "Single Price",
    ">Accessory<",
    ">Supplier Code<",
    ">Dimension<",
    ">Price<",
    ">Specification / Notes<",
    "sectionRows.map((row)",
    'value={row.price ?? ""}',
    "price: nullableReviewNumber(event.target.value)",
    "formatDraftDimensions(row.dimensions)",
    "overflow-x-auto",
    "VisualSubgroupCards",
  ].forEach((expected) => assert.ok(scalarRenderer.includes(expected), `Expected scalar table behavior: ${expected}`));
  assert.equal(scalarRenderer.includes(".sort("), false, "Scalar item source order must not be sorted");
});

test("category matrix preserves source category and item order with editable isolated cells", () => {
  [
    "Category Pricing · {priceCategories.length} categories · {accessoryRows.length} items",
    ">Accessory<",
    ">Supplier Code<",
    ">Dimension<",
    "priceCategories.map((category)",
    "section.rows.map((row)",
    "row.prices?.[category.id] ?? \"\"",
    "prices: { ...row.prices, [category.id]: nullableReviewNumber(event.target.value) }",
    "formatDraftDimensions(row.dimensions)",
    "overflow-x-auto",
    "w-24",
  ].forEach((expected) => assert.ok(categoryRenderer.includes(expected), `Expected category matrix behavior: ${expected}`));
  assert.equal(categoryRenderer.includes(".sort("), false, "Category and item source order must not be sorted");
});

test("null and unavailable category prices never render as zero", () => {
  assert.ok(categoryRenderer.includes('row.prices?.[category.id] ?? ""'));
  assert.ok(categoryRenderer.includes("nullableReviewNumber(event.target.value)"));
  assert.ok(categoryRenderer.includes("row.unavailablePriceCategoryIds?.includes(category.id)"));
  assert.ok(categoryRenderer.includes("disabled={unavailable}"));
  assert.ok(categoryRenderer.includes(">N/A<"));
  assert.equal(categoryRenderer.includes("?? 0"), false);
});

test("category heading labels edit live without changing IDs, order, or item price maps", () => {
  [
    "Edit categories",
    'aria-label="Price Categories"',
    "priceCategories.map((category, categoryIndex)",
    "key={category.id}",
    "value={category.label}",
    "index === categoryIndex ? { ...item, label: event.target.value } : item",
    "onPriceCategoriesChange",
    "onPriceCategoriesChange={(priceCategories) => onChange",
    "{ ...item, priceCategories }",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected category-label behavior: ${expected}`));
  assert.equal(categoryRenderer.includes("prices:"), true, "Category prices must remain independently editable");
  assert.equal(categoryRenderer.includes("category.id:"), false, "Label editing must never derive a new category ID");
});

test("row details retain metadata controls without duplicating category pricing", () => {
  [
    "Edit / Details",
    "StagedPricingRowReferenceImage",
    'TextField label="Label"',
    'TextField label="Display name"',
    'TextField label="Supplier codes"',
    'TextField label="Reference codes"',
    'TextField label="Dimensions / raw text"',
    "CurrencyField",
    "Product Specification",
    "ImportantRequirementsField",
    "SpecificationEnrichmentControl",
  ].forEach((expected) => assert.ok(categoryRenderer.includes(expected), `Expected row detail control: ${expected}`));
  assert.equal(categoryRenderer.includes("<PriceField"), false, "Expanded details must not repeat category price inputs");
  ["Edit / Details", "StagedPricingRowReferenceImage", "ImportantRequirementsField", "SpecificationEnrichmentControl"].forEach((expected) => assert.ok(scalarRenderer.includes(expected), `Expected scalar detail control: ${expected}`));
});

test("Direct Modular renders a compact row table with the required columns and Edit / Details action", () => {
  [
    "overflow-x-auto",
    "<table",
    ">Display Name<",
    ">Supplier Code<",
    ">Dimension<",
    ">Price<",
    ">Role<",
    ">Action<",
    "rows.map((row)",
    "Edit / Details",
    "formatDraftDimensions(row.dimensions)",
  ].forEach((expected) => assert.ok(directModularRenderer.includes(expected), `Expected Direct Modular compact table behavior: ${expected}`));
});

test("Direct Modular keeps display name, supplier code, price, and role inline-editable in the compact row", () => {
  [
    'aria-label="Display name"',
    'value={row.displayName ?? row.label ?? ""}',
    "displayName: nullableText(event.target.value)",
    "supplier code`}",
    "supplierCodes: event.target.value.trim() ? [event.target.value.trim()] : []",
    "price`}",
    'type="number"',
    "price: event.target.value === \"\" ? null : Number(event.target.value)",
    "role`}",
    "<select",
    'role: (event.target.value || undefined) as ProductTemplateDraftModularDirectRow["role"]',
    '<option value="">None</option><option value="starter">Starter</option><option value="intermediate">Intermediate</option><option value="terminal">Terminal</option>',
  ].forEach((expected) => assert.ok(directModularRenderer.includes(expected), `Expected inline-editable field: ${expected}`));
});

test("Direct Modular Edit / Details exposes specification and Important Requirements without duplicating price/role", () => {
  [
    "aria-expanded={expanded}",
    "aria-controls={`modular-direct-row-${row.id}`}",
    'TextField label="Label"',
    'TextField label="Supplier codes"',
    'TextField label="Reference codes"',
    'TextField label="Dimensions / raw text"',
    "CurrencyField",
    'multiline label="Specification"',
    "ImportantRequirementsField",
  ].forEach((expected) => assert.ok(directModularRenderer.includes(expected), `Expected Direct Modular detail control: ${expected}`));
  const detailsBlock = directModularRenderer.slice(directModularRenderer.indexOf('id={`modular-direct-row-'));
  assert.equal(detailsBlock.includes('type="number"'), false, "Details must not repeat the compact table's price input");
  assert.equal(detailsBlock.includes("<select"), false, "Details must not repeat the compact table's role select");
});

test("Direct Modular row updates are scoped to a single row by id, and composition min/max starters remain untouched", () => {
  assert.ok(directModularRenderer.includes("rows.map((row) => row.id === rowId ? { ...row, ...patch } : row)"), "Expected row updates to target only the matching row id");
  assert.ok(directModularRenderer.includes("const update = (rowId: string, patch: Partial<ProductTemplateDraftModularDirectRow>)"));
  assert.ok(directModularRenderer.includes("composition ? ` — starters ${composition.minStarters}–${composition.maxStarters ?? \"∞\"}` : \"\""), "Expected the starter min/max composition summary to remain unchanged");
});

test("Matrix Modular editor is untouched by the Direct Modular compact table change", () => {
  [
    "matrix.columns.map((column)",
    "matrix.rows.flatMap((row)",
    "sticky left-0 z-10 min-w-64 bg-white",
    "unavailableCategoryIds",
  ].forEach((expected) => assert.ok(matrixEditorRenderer.includes(expected), `Expected Matrix Modular editor to still contain: ${expected}`));
  assert.equal(matrixEditorRenderer.includes("DirectModularRowsEditor"), false, "Expected the Matrix editor to remain independent of the Direct Modular table");
});

test("the modular section still branches to DirectModularRowsEditor only when a group has no matrix", () => {
  assert.ok(source.includes("group.matrix ? <MatrixEditor"));
  assert.ok(source.includes(": <DirectModularRowsEditor rows={group.directRows ?? []} composition={group.composition ?? null}"));
});

const legacyRenderer = source.slice(source.indexOf("function LegacyPricedRowsEditor"), source.indexOf("type PricedRowsEditorProps"));
const denseRowRenderer = legacyRenderer.slice(legacyRenderer.indexOf('dense ? <div className="overflow-x-auto"><table'), legacyRenderer.indexOf(': <div className="space-y-2">'));
const denseTableHeadRegion = denseRowRenderer.slice(0, denseRowRenderer.indexOf("<tbody>"));
const denseCompactRowRegion = denseRowRenderer.slice(denseRowRenderer.indexOf("<tbody>"), denseRowRenderer.indexOf('{expanded ? <tr id={`priced-row-'));
const denseDetailsRegion = denseRowRenderer.slice(denseRowRenderer.indexOf('{expanded ? <tr id={`priced-row-'));

test("1: Base/Model dense review rows render compact primary fields", () => {
  [">Image<", ">Model<", ">Supplier Code<", ">Dimension<", ">Price<", ">Currency<", ">Details<"].forEach((expected) => assert.ok(denseTableHeadRegion.includes(expected), `Expected compact Base/Model table column: ${expected}`));
  [
    "StagedPricingRowReferenceImage",
    "row.displayName || row.label || row.id",
    "row.dimensions ? formatDraftDimensions(row.dimensions) : \"-\"",
    'row.currency ?? "No currency"',
    'type="number"',
    "Edit / Details",
  ].forEach((expected) => assert.ok(denseCompactRowRegion.includes(expected), `Expected compact Base/Model field: ${expected}`));
});

test("2: specification is hidden from the compact Base/Model row until Edit / Details is expanded", () => {
  assert.equal(denseCompactRowRegion.includes("row.specification"), false, "Specification must not render in the always-visible compact row");
  assert.ok(denseDetailsRegion.includes('multiline label="Product Specification" value={row.specification}'), "Specification must still be editable inside Details");
});

test("3: importantRequirements are hidden from the compact Base/Model row until Edit / Details is expanded", () => {
  assert.equal(denseCompactRowRegion.includes("importantRequirements"), false, "Important requirements must not render in the always-visible compact row");
  assert.ok(denseDetailsRegion.includes("ImportantRequirementsField"), "Important requirements must still be editable inside Details");
});

test("4: price remains directly editable in the compact Base/Model row", () => {
  assert.ok(denseCompactRowRegion.includes("price: nullableReviewNumber(event.target.value)"));
  assert.ok(denseCompactRowRegion.includes('value={row.price ?? ""}'));
});

test("5: image controls remain available in the compact Base/Model row", () => {
  assert.ok(denseCompactRowRegion.includes("StagedPricingRowReferenceImage sourceKey={imageScope} rowId={row.id}"));
});

test("6: the Base/Model Details toggle only flips local expand state and never mutates row data", () => {
  assert.ok(denseRowRenderer.includes("setDenseExpandedRowId((current) => current === row.id ? null : row.id)"));
  const toggleHandler = denseRowRenderer.slice(denseRowRenderer.indexOf("onClick={() => setDenseExpandedRowId"), denseRowRenderer.indexOf("onClick={() => setDenseExpandedRowId") + 80);
  assert.equal(toggleHandler.includes("setRow("), false, "Toggling Details must never call setRow");
  assert.equal(toggleHandler.includes("onChange("), false, "Toggling Details must never call onChange");
});

test("only one Base/Model row's Details can be expanded at a time", () => {
  assert.ok(source.includes("const [denseExpandedRowId, setDenseExpandedRowId] = useState<string | null>(null);"));
  assert.equal(denseRowRenderer.includes("expandedRows[row.id]"), false, "Dense rows must use the single-expanded-row id, not the multi-row expandedRows map");
});

test("7: existing explicit visual subgroup assignments remain authoritative and are never overwritten by inference", () => {
  assert.ok(source.includes('setReviewedSubgroups(nextDraft ? { "base_model:rows": inferBaseModelVisualSubgroups(nextDraft.pricing.baseModelRows) } : {});'), "Auto-inference must only run for a fresh validate(), which starts with no explicit subgroups");
  assert.ok(source.includes("setReviewedSubgroups(workspace.subgroups ?? {});"), "Loading an existing workspace must reuse its already-explicit subgroup assignments, not re-infer them");
});

test("13: manual visual subgroup controls remain available for Base/Model rows", () => {
  ["+ Add Subgroup", "Assign {itemLabel}", "Remove", "Ungrouped: {rows.filter((row) => !assigned.has(row.id)).length}"].forEach((expected) => assert.ok(source.includes(expected), `Expected manual subgroup control: ${expected}`));
});

test("14: auto visual-subgroup inference is wired only into the Base/Model route and never touches Accessories/Companion review", () => {
  const inferenceCallSites = [...source.matchAll(/inferBaseModelVisualSubgroups\(/g)];
  assert.equal(inferenceCallSites.length, 1, "inferBaseModelVisualSubgroups must be called exactly once (Base/Model only)");
  const accessoryRenderer = source.slice(source.indexOf("function SmartAccessoryRowsEditor"), source.indexOf("function PricedRowsEditor"));
  assert.equal(accessoryRenderer.includes("inferBaseModelVisualSubgroups"), false, "Accessory/Companion rendering must never call the Base/Model auto-grouping helper");
});

// ---------------------------------------------------------------------------
// UI parity correction: Base/Model must render as compact single-expand
// accordions (matching Modular/Workstation), and the large subgroup
// management block must be hidden by default behind "Manage groups" instead
// of duplicating subgroup membership information above the pricing rows.
// ---------------------------------------------------------------------------

const baseModelSectionRegion = source.slice(source.indexOf('{draft.pricing.baseModelRows.length'), source.indexOf('{draft.pricing.priceMatrices.length'));

test("UI parity 1: normal Base/Model review does not unconditionally render the large subgroup-management block", () => {
  assert.ok(baseModelSectionRegion.includes("baseModelManageGroupsOpen ? <SmartSubgroupEditor"), "SmartSubgroupEditor must be gated behind the Manage groups toggle, not rendered unconditionally");
  assert.equal(/routeItems\(draft, baseModelRoute\)\.length \? <SmartSubgroupEditor/.test(baseModelSectionRegion), false, "SmartSubgroupEditor must no longer render directly whenever there are route items");
});

test("UI parity 2 & 3: each Base/Model subgroup renders as a single compact accordion with label + item count in its header", () => {
  assert.ok(source.includes('singleExpand?: boolean'));
  assert.ok(source.includes('itemLabel={dense ? "model" : "item"} rows={rows} subgroups={subgroups} renderRows={renderRows} singleExpand={dense}'), "Base/Model must request accordion (single-expand) VisualSubgroupCards behavior");
  assert.ok(source.includes('<p className="text-sm font-semibold text-zinc-900">{label}</p><p className="mt-1 text-xs text-zinc-500">{section.rows.length} {itemLabel}'), "Subgroup header must show only the label and item count, no full member list");
});

test("UI parity 4 & 5: expanded subgroup renders the compact pricing table, collapsed subgroup hides it", () => {
  assert.ok(source.includes('{expanded ? <div className="border-t border-zinc-200">{renderRows(section.rows)}</div> : null}'), "Rows must only render while the accordion section is expanded");
});

test("UI parity 8: Manage groups exposes rename/Assign/Remove controls only once opened", () => {
  assert.ok(baseModelSectionRegion.includes('{baseModelManageGroupsOpen ? "Hide group management" : "Manage groups"}'));
  const manageGroupsBlock = baseModelSectionRegion.slice(baseModelSectionRegion.indexOf("Manage groups"), baseModelSectionRegion.indexOf("<PricedRowsEditor"));
  assert.ok(manageGroupsBlock.includes("<SmartSubgroupEditor"), "The rename/Assign/Remove controls (SmartSubgroupEditor) must live inside the Manage groups toggle region");
});

test("UI parity 9: manual subgroup functionality (SmartSubgroupEditor itself) is unchanged", () => {
  ["+ Add Subgroup", "Assign {itemLabel}", "Remove", "rename", "openAssignment", "assignVisualSubgroupRows"].forEach((expected) => assert.ok(source.includes(expected) || source.toLowerCase().includes(expected.toLowerCase()), `Expected unchanged manual subgroup control reference: ${expected}`));
});

test("UI parity 10: inferred subgroup membership computation is unchanged by this presentation-only task", () => {
  assert.ok(source.includes('setReviewedSubgroups(nextDraft ? { "base_model:rows": inferBaseModelVisualSubgroups(nextDraft.pricing.baseModelRows) } : {});'), "Inference wiring must be byte-identical to the prior task's implementation");
});

test("UI parity 11: Ungrouped rows use exactly the same accordion/table pattern as named subgroups (no special-case UI)", () => {
  assert.equal(source.includes("Ungrouped UI"), false);
  assert.ok(source.includes('const label = section.subgroup?.subgroup_name ?? "Ungrouped";'), "The Ungrouped section must flow through the same VisualSubgroupCards section rendering as every named subgroup");
});

test("UI parity 12: Accessories UI is unaffected by the Base/Model accordion change", () => {
  const accessoryRenderer = source.slice(source.indexOf("function SmartAccessoryRowsEditor"), source.indexOf("function PricedRowsEditor"));
  assert.equal(accessoryRenderer.includes("singleExpand"), false, "Accessory rendering must not opt into the new single-expand accordion behavior");
  assert.equal(accessoryRenderer.includes("baseModelManageGroupsOpen"), false);
});

// ---------------------------------------------------------------------------
// GLOBAL group-level "+ Import More JSON": reuses AdditionalJsonDialog (no
// second modal), reuses the existing "smart-product-add-more-json" event with
// an added target payload, and reuses compatible()/duplicate-review helpers.
// ---------------------------------------------------------------------------

const additionalJsonDialogRenderer = source.slice(source.indexOf("function AdditionalJsonDialog"), source.indexOf("function routeItems"));
const reviewDestinationSectionRenderer = source.slice(source.indexOf("function ReviewDestinationSection"), source.indexOf("function SmartSubgroupEditor"));

test("1: '+ Import More JSON' triggers exist only on supported group headers (Workstation, Base/Model main, Base/Model subgroup, Matrix, Matrix Modular, Direct Modular, Accessory)", () => {
  assert.ok(source.includes("function openGroupImportMoreJson(targetRouteKey: string, targetSubgroupId?: string)"));
  assert.ok(source.includes('window.dispatchEvent(new CustomEvent("smart-product-add-more-json", { detail: { targetRouteKey, targetSubgroupId } }));'));
  const workstationImportTrigger = "onImportMore={workstationRoute ? () => openGroupImportMoreJson(workstationRoute.key) : undefined}";
  const baseModelImportTrigger = "onImportMore={baseModelRoute ? () => openGroupImportMoreJson(baseModelRoute.key) : undefined}";
  const matrixModularAccessoryImportTrigger = "onImportMore={route ? () => openGroupImportMoreJson(route.key) : undefined}";
  [workstationImportTrigger, baseModelImportTrigger].forEach((expected) => assert.ok(source.includes(expected), `Expected trigger: ${expected}`));
  const matrixModularAccessoryOccurrences = source.split(matrixModularAccessoryImportTrigger).length - 1;
  assert.equal(matrixModularAccessoryOccurrences, 3, "Expected exactly 3 generic per-route triggers: Matrix, Modular (Direct + Matrix Modular share one loop), and Accessory/Option");
  assert.ok(source.includes("onImportMoreForSubgroup={baseModelRoute ? (subgroupId) => openGroupImportMoreJson(baseModelRoute.key, subgroupId) : undefined}"), "Base/Model visual subgroup must launch a targeted import scoped to that subgroup");
});

test("2: no second import modal exists - the button reuses AdditionalJsonDialog via the existing event", () => {
  assert.equal((source.match(/function \w*Dialog\b/g) ?? []).filter((name) => /Json|Import/i.test(name)).length, 1, "Expected exactly one JSON import dialog component to exist");
  assert.ok(source.includes('window.addEventListener("smart-product-add-more-json", openAdditionalJson)'));
});

test("2b: the button is not added to material suggestions, linked family suggestions, Source QA, or warnings panels", () => {
  const materialsSection = source.slice(source.indexOf('{draft.materialSuggestions.length'), source.indexOf('{draft.linkedFamilySuggestions.length'));
  const linkedSection = source.slice(source.indexOf('{draft.linkedFamilySuggestions.length'), source.indexOf('<BatchSpecificationEnrichmentControl'));
  assert.equal(materialsSection.includes("openGroupImportMoreJson"), false);
  assert.equal(linkedSection.includes("openGroupImportMoreJson"), false);
});

test("3 & 4: targeted mode shows the selected target, runs the same classification, and constrains merge to only the compatible target route (reusing compatible())", () => {
  assert.ok(additionalJsonDialogRenderer.includes("const targeted = Boolean(targetRouteKey);"));
  assert.ok(additionalJsonDialogRenderer.includes("const isCompatible = compatible(currentDraft, preparedIncoming, targetRoute, route);"));
  assert.ok(additionalJsonDialogRenderer.includes('action: isCompatible ? "merge" : "skip"'));
  assert.ok(additionalJsonDialogRenderer.includes("Target: {targetLabel ?? targetRoute?.groupName"));
  assert.ok(additionalJsonDialogRenderer.includes("This JSON does not contain rows compatible with the selected target group."));
});

test("5: targeted route selection merges into the explicitly selected target even when the incoming group id differs, using compatibility + explicit target, not id equality", () => {
  assert.ok(additionalJsonDialogRenderer.includes("targetKey: isCompatible ? targetRouteKey! : null"), "A compatible incoming route (any generated id) must merge into the user-selected target, not require id equality");
});

test("6: duplicate/conflict UI (Keep Existing / Use Incoming) is reused unchanged in targeted mode", () => {
  assert.ok(additionalJsonDialogRenderer.includes('smartAdditionalDuplicateRows(currentDraft, incomingDraft, route, target)'));
  assert.ok(additionalJsonDialogRenderer.includes('<option value="existing">Keep Existing</option><option value="incoming">Use Incoming</option>'));
});

test("7: applySmartAdditionalJson's addedRowsByTarget is threaded through onAdd for Base/Model subgroup row_id assignment", () => {
  assert.ok(additionalJsonDialogRenderer.includes("onAdd(merged.draft, merged.plan, rawJson, partialExtractionStatus(enrichedIncoming.extractionWarnings), merged.addedRowsByTarget);"));
  assert.ok(source.includes('const newRowIds = addedRowsByTarget["base_model:rows"] ?? [];'));
  assert.ok(source.includes("row_ids: [...new Set([...subgroup.row_ids, ...newRowIds])]"), "New row ids must be appended without duplicating existing row_ids");
});

test("13: top-level '+ Add More JSON' dispatches with no target payload, keeping its full unconstrained Add/Merge/Skip UI", () => {
  assert.ok(source.includes('window.dispatchEvent(new Event("smart-product-add-more-json"))'), "Top-level triggers must not pass a targetRouteKey");
  assert.ok(additionalJsonDialogRenderer.includes('setDecisions(Object.fromEntries(incomingGroups.map(({ route, compatibleTargets, match }) => [route.key, { action: (["workstation", "base_model"].includes(route.sourceKind)'), "Untargeted validate() must retain its original full classification logic unchanged");
  assert.ok(additionalJsonDialogRenderer.includes('<option value="add" disabled={flatAlreadyExists}>Add as New Group</option>'), "Untargeted mode must still offer Add as New Group / Merge / Skip");
});

test("14 & 15: wrong-target rejection is visible in the UI as a per-route status, not a silent success", () => {
  assert.ok(additionalJsonDialogRenderer.includes('"Rejected - not compatible with the selected target group"'));
  assert.ok(additionalJsonDialogRenderer.includes("Compatible - will merge into ${targetLabel"));
});

test("ReviewDestinationSection renders the '+ Import More JSON' button next to Show/Hide only when onImportMore is provided", () => {
  assert.ok(reviewDestinationSectionRenderer.includes("onImportMore?: () => void"));
  assert.ok(reviewDestinationSectionRenderer.includes('{onImportMore ? <button type="button" onClick={onImportMore}'));
});

const parseFallbackWrapper = source.slice(source.indexOf("function parseSmartProductJsonWithFallback"), source.indexOf("type SmartSetupSourcePdfMeta ="));

test("quote-repair fallback: original JSON.parse is tried first and no extraction/repair is invoked when it already succeeds", () => {
  assert.ok(source.includes('import { repairLikelyUnescapedJsonQuotes } from "@/lib/products/repair-ai-json-quotes";'), "Must import the pure quote-repair helper");
  assert.ok(source.includes('import { extractLikelyAiJsonPayload } from "@/lib/products/extract-ai-json-payload";'), "Must import the pure wrapped-JSON extraction helper");
  assert.ok(source.includes("function parseSmartProductJsonWithFallback(rawJson: string)"), "Must define a single shared parse-with-fallback wrapper (no duplicated scanner/extraction logic)");
  assert.ok(/try\s*\{\s*JSON\.parse\(rawJson\);\s*return \{ result: parseSmartProductJsonImport\(rawJson\), finalText: null, wrapperRemoved: false, quoteRepaired: false \};/.test(parseFallbackWrapper), "Original text must be parsed first; on success it must be used unchanged with no extraction or repair invoked");
});

test("quote-repair fallback: invalid quote-only JSON (no wrapper) is repaired and becomes parseable, then goes through normal ProductTemplateDraft validation", () => {
  assert.ok(parseFallbackWrapper.includes("const payload = extractLikelyAiJsonPayload(rawJson);"), "Must attempt wrapped-payload extraction before falling back to quote repair on the original text");
  assert.ok(parseFallbackWrapper.includes("const repair = repairLikelyUnescapedJsonQuotes(rawJson);"), "When no payload was extracted, quote repair runs on the original text exactly as before");
  assert.ok(parseFallbackWrapper.includes("if (repair.repaired && repair.repairCount > 0) {"), "Repair is only used when it actually produced changes");
  assert.ok(parseFallbackWrapper.includes("return { result: parseSmartProductJsonImport(repair.text), finalText: repair.text, wrapperRemoved: false, quoteRepaired: true };"), "A successfully repaired+parseable text is validated through the SAME parseSmartProductJsonImport path as any other JSON, never bypassing ProductTemplateDraft validation");
});

test("quote-repair fallback: unrepaired/unrepairable malformed JSON still shows the existing syntax error behavior unchanged", () => {
  assert.ok(parseFallbackWrapper.includes("return { result: parseSmartProductJsonImport(rawJson), finalText: null, wrapperRemoved: false, quoteRepaired: false };"), "Falls back to validating the ORIGINAL text (preserving the existing JSON syntax error) whenever neither extraction nor repair produces parseable JSON");
});

test("quote-repair fallback: both the initial-import and Add More JSON flows use the shared wrapper, and a non-blocking notice is shown only when extraction and/or repair actually occurred", () => {
  assert.ok(source.includes("function ParseFallbackNotice({ quoteRepaired, wrapperRemoved }: { quoteRepaired: boolean; wrapperRemoved: boolean })"), "A dedicated small non-blocking notice component must exist, covering both wrapper-removal and quote-repair");
  assert.ok(source.includes("Minor JSON quote escaping was repaired automatically. Review the corrected JSON before applying."), "Quote-repair-only notice text must match exactly");
  assert.ok(source.includes("AI response wrapper was removed automatically. Review the extracted JSON before applying."), "Wrapper-removal-only notice text must match exactly");
  assert.ok(source.includes("AI response wrapper and minor JSON quote escaping were repaired automatically. Review the corrected JSON before applying."), "Combined wrapper-removal + quote-repair notice text must match exactly");
  const noticeUses = [...source.matchAll(/<ParseFallbackNotice quoteRepaired=\{quoteRepaired\} wrapperRemoved=\{wrapperRemoved\} \/>/g)];
  assert.equal(noticeUses.length, 2, "Both the initial AI JSON textarea flow and the Add More JSON dialog flow must render the notice");
  const parseWithFallbackUses = [...source.matchAll(/const \{ result: (?:next|nextResult), finalText, wrapperRemoved: didExtractWrapper, quoteRepaired: didRepairQuotes \} = parseSmartProductJsonWithFallback\(rawJson\);/g)];
  assert.equal(parseWithFallbackUses.length, 2, "Both validate() flows must go through the same shared parse-with-fallback wrapper, not a duplicated scanner/extraction");
  assert.equal((source.match(/function repairLikelyUnescapedJsonQuotes/g) ?? []).length, 0, "The quote-repair scanner implementation itself must live only in the shared lib helper, never duplicated inside the component");
  assert.equal((source.match(/function extractLikelyAiJsonPayload/g) ?? []).length, 0, "The wrapped-JSON extraction implementation itself must live only in the shared lib helper, never duplicated inside the component");
});

test("wrapped-JSON fallback: payload extraction is tried before quote repair, and extraction never bypasses ProductTemplateDraft validation", () => {
  assert.ok(parseFallbackWrapper.includes("if (payload.extracted) {"), "Only an actually-extracted candidate (json_fence or version_object) is attempted before falling back to plain quote repair on the original text");
  assert.ok(parseFallbackWrapper.includes("JSON.parse(payload.text);"), "The extracted candidate is parsed on its own first, before any quote repair is attempted on it");
  assert.ok(parseFallbackWrapper.includes("return { result: parseSmartProductJsonImport(payload.text), finalText: payload.text, wrapperRemoved: true, quoteRepaired: false };"), "A cleanly parseable extracted payload is validated through the SAME parseSmartProductJsonImport path, never bypassing validation");
  assert.ok(parseFallbackWrapper.includes("const repair = repairLikelyUnescapedJsonQuotes(payload.text);"), "If the extracted payload alone does not parse, quote repair is attempted on the extracted payload text");
  assert.ok(parseFallbackWrapper.includes("return { result: parseSmartProductJsonImport(repair.text), finalText: repair.text, wrapperRemoved: true, quoteRepaired: true };"), "A payload that needed both wrapper extraction and quote repair still goes through the SAME parseSmartProductJsonImport validation path");
});

test("wrapped-JSON fallback: malformed content with no extractable candidate still shows the existing syntax error", () => {
  assert.ok(parseFallbackWrapper.includes("return { result: parseSmartProductJsonImport(rawJson), finalText: null, wrapperRemoved: false, quoteRepaired: false };"), "When extraction finds no candidate (extracted: false) and repair does not help, the original text is validated as-is, preserving the existing syntax-error UI");
});

const localRouteControlsRenderer = source.slice(source.indexOf("function LocalRouteControls"), source.indexOf("/** Dispatches the same event"));

test("Accessories Advanced Setup: focus is threaded from SmartProductJsonImport through SmartProductReview down to the route controls, using only the existing focus prop", () => {
  assert.ok(source.includes('import type { ExtractionPromptFocus } from "@/lib/products/product-template-ai-extraction-prompt";'), "Must reuse the existing ExtractionPromptFocus type rather than inventing a new enum");
  assert.ok(source.includes("focus = null,"), "focus must be optional and default to null, preserving current behavior for callers that omit it");
  assert.ok(source.includes("focus?: ExtractionPromptFocus | null;"), "The focus prop type must be the existing ExtractionPromptFocus union, not a new type");
  assert.ok(source.includes("<SmartProductReview editMode={editMode} focus={focus} draft={reviewedDraft}"), "focus must be threaded into SmartProductReview");
  assert.ok(source.includes("const isAccessoriesFocus = focus === \"accessories\";"), "Must use the exact existing focus id 'accessories', never an invented value");
});

test("Accessories Advanced Setup: is derived from focus metadata only, never from product/template/supplier names or row content", () => {
  const bodyStart = source.indexOf("function SmartProductReviewBody");
  const isAccessoriesFocusLine = source.slice(bodyStart, bodyStart + 1200);
  assert.ok(isAccessoriesFocusLine.includes("const isAccessoriesFocus = focus === \"accessories\";"));
  const declarationOnly = source.slice(source.indexOf("const isAccessoriesFocus ="), source.indexOf("const isAccessoriesFocus =") + 52);
  ["templateName", "supplierName", "item_name", "displayName", "electrification"].forEach((forbidden) => {
    assert.ok(!declarationOnly.includes(forbidden), `isAccessoriesFocus must not reference ${forbidden}`);
  });
});

test("Accessories Advanced Setup: starts collapsed by default and is local per-route UI state (not shared across route groups)", () => {
  assert.ok(localRouteControlsRenderer.includes("const [advancedSetupOpen, setAdvancedSetupOpen] = useState(false);"), "Must start collapsed (false) and be a local hook inside LocalRouteControls, so every rendered route/group instance owns an independent state cell");
});

test("Option-group Advanced Setup: renders the compact 'Advanced Setup' / 'Hide Advanced Setup' button and gates its existing controls behind it", () => {
  assert.ok(localRouteControlsRenderer.includes('{advancedSetupOpen ? "Hide Advanced Setup" : "Advanced Setup"}'), "Button label must toggle between the exact required collapsed/expanded text");
  assert.ok(localRouteControlsRenderer.includes("if (!isAccessoriesFocus && !alwaysAdvancedSetup) return controls;"), "Only option groups can opt into the existing disclosure regardless of focus");
  assert.ok(localRouteControlsRenderer.includes("{advancedSetupOpen ? <div className=\"mt-2\">{controls}{advancedContent}</div> : null}"), "Controls and the option-group Advanced Setup content only render when expanded");
});

test("option groups use the compact layout globally and place item rows before one shared Advanced Setup disclosure", () => {
  const optionGroupSite = source.slice(source.indexOf("{draft.optionGroups.length"), source.indexOf("{draft.materialSuggestions.length"));
  assert.equal(optionGroupSite.includes("isAccessoriesFocus ? orderItemsByRoute"), false, "Option groups must not require accessories focus");
  ["compactConfigurationSummary", "roleLabels[route.accessory.role]", "selectionLabels[route.accessory.selection]", "route.accessory.rules.length", "alwaysAdvancedSetup", "{groupMarker}{structuralSupportStatus}{itemFindingsSummary}{itemRows}", "Subgroups: {groupSubgroups.length ? groupSubgroups.length : \"None\"}", "{subgroupEditor}", "{optionGroupLabelEditor}{extractedSelectionRule}"].forEach((expected) => assert.ok(optionGroupSite.includes(expected), `Expected global compact option-group UI: ${expected}`));
  assert.ok(optionGroupSite.indexOf("const itemRows") < optionGroupSite.indexOf("<LocalRouteControls"), "Item rows must precede Advanced Setup");
});

test("option-group compact layout applies with null, Screens, Desk, and other focus values without changing data writers", () => {
  const optionGroupSite = source.slice(source.indexOf("{draft.optionGroups.length"), source.indexOf("{draft.materialSuggestions.length"));
  assert.equal(optionGroupSite.includes("focus === \"accessories\""), false);
  assert.equal(optionGroupSite.includes("isAccessoriesFocus ?"), false);
  assert.ok(optionGroupSite.includes("onChange={(items) => onChange({ ...draft, optionGroups: draft.optionGroups.map"));
  assert.ok(optionGroupSite.includes("onChange={(next) => onSubgroupsChange({ ...subgroups, [route.key]: next })}"));
});

test("Accessories Advanced Setup: expanding it reveals Apply As, Destination Group, Skip, ordering, SYSTEM / BASE, and Manage row roles - all existing controls, none duplicated", () => {
  assert.ok(localRouteControlsRenderer.includes(">Apply As<"));
  assert.ok(localRouteControlsRenderer.includes(">Destination Group<"));
  assert.ok(localRouteControlsRenderer.includes('{route.destination === "skip" ? "Restore" : "Skip"}'));
  assert.ok(localRouteControlsRenderer.includes(`aria-label={\`Move \${route.sourceName} up\`}`));
  assert.ok(localRouteControlsRenderer.includes(`aria-label={\`Move \${route.sourceName} down\`}`));
  assert.ok(localRouteControlsRenderer.includes("{extra}"), "extra (SYSTEM / BASE + Manage row roles) must render inside the same controls block, sharing the one Advanced Setup panel");
  assert.equal((localRouteControlsRenderer.match(/>Apply As</g) ?? []).length, 1, "Apply As must not be duplicated within LocalRouteControls when moved behind Advanced Setup");
  assert.equal((source.match(/function LocalRouteControls/g) ?? []).length, 1, "LocalRouteControls itself must not be duplicated");
  assert.equal((source.match(/function BaseModelRoleControls/g) ?? []).length, 1, "BaseModelRoleControls (SYSTEM / BASE, Manage row roles) must not be duplicated");
  const systemGroupSite = source.slice(source.indexOf('title: `System Group:'), source.indexOf('title: `System Group:') + 2500);
  assert.ok(systemGroupSite.includes("extra={<BaseModelRoleControls rows={groupRows} onChange={changeRole} />}"), "The System Group call site must pass BaseModelRoleControls as the shared extra content instead of rendering it as a separate always-visible sibling");
});

test("Accessories Advanced Setup: product rows, families, and model data stay visible outside the collapsible panel", () => {
  ["PricedRowsEditor", "MatrixEditor", "DirectModularRowsEditor"].forEach((editor) => {
    assert.ok(source.includes(`<${editor} `), `${editor} must still be rendered`);
  });
  const optionGroupSite = source.slice(source.indexOf("title: accessoriesTitle"), source.indexOf("title: accessoriesTitle") + 3200);
  const localRouteControlsCallEnd = optionGroupSite.indexOf("isAccessoriesFocus={isAccessoriesFocus} /> : null}") + "isAccessoriesFocus={isAccessoriesFocus} /> : null}".length;
  const pricedRowsEditorIndex = optionGroupSite.indexOf("<PricedRowsEditor");
  assert.ok(pricedRowsEditorIndex > localRouteControlsCallEnd, "PricedRowsEditor (the actual product rows: model, supplier code, dimension, price, currency) must be a sibling after LocalRouteControls's call, never nested inside its collapsible content");
  assert.ok(source.includes("MAIN PRODUCT FAMILIES"), "Native System/Base main product family cards must remain a separate, always-reachable element");
});

test("other pricing sections retain their existing focus behavior", () => {
  assert.ok(localRouteControlsRenderer.includes("isAccessoriesFocus?: boolean;"), "isAccessoriesFocus must be optional so existing call sites without focus information keep working");
  assert.ok(localRouteControlsRenderer.includes("if (!isAccessoriesFocus && !alwaysAdvancedSetup) return controls;"));
  const workstationSection = source.slice(source.indexOf('title: "Workstation Pricing"'), source.indexOf('{draft.optionGroups.length'));
  assert.ok(workstationSection.includes("isAccessoriesFocus={isAccessoriesFocus}"));
  assert.equal(workstationSection.includes("alwaysAdvancedSetup"), false, "Only option groups opt into global Advanced Setup");
});

const optionGroupsSection = source.slice(source.indexOf('title: accessoriesTitle'), source.indexOf('title: "Material Suggestions"'));

test("option_item dependency issue: uses the existing routing-validation error collection, not a parallel system", () => {
  const reviewBody = source.slice(source.indexOf("function SmartProductReviewBody"), source.indexOf("export function SmartProductJsonImport"));
  assert.ok(source.includes("const optionGroupRoutingIssues = plan ? validateSmartSetupReviewRouting(draft, plan).errors : [];"), "Must read from the SAME validateSmartSetupReviewRouting(...).errors used for blocking, never a duplicated/parallel validation call for this purpose");
  assert.equal((reviewBody.match(/validateSmartSetupReviewRouting\(/g) ?? []).length, 1, "validateSmartSetupReviewRouting must be invoked only once inside SmartProductReviewBody itself (other components computing it independently for their own purposes is unrelated)");
});

test("7: the dependency issue is included in the same blocking-issue collection that disables Apply", () => {
  // routingValidation.errors already feeds smartSetupBlockingIssues, and Apply/Save Changes is already
  // disabled by !routingValidation.valid — both computed from validateSmartSetupReviewRouting(...), the
  // exact function extended with the new cross-option-group check, so no separate wiring is required.
  assert.ok(source.includes("routingErrors: [...routingValidation.errors, ...structuralSupportCompatibilityMessages]"));
  assert.ok(source.includes("disabled={!routingValidation.valid || currencyState?.hasUnresolvedPricedRows || accessoryReviewBlocked}"));
  assert.ok(source.includes("!reviewedDraft || !routingPlan || !validateSmartSetupReviewRouting(reviewedDraft, routingPlan).valid"), "requestApply's own guard must also block on the same routing validity, not only the disabled button");
});

test("8: the dependency warning is rendered for the dependent option group, outside/before the Advanced Setup panel so it stays visible while collapsed", () => {
  assert.ok(optionGroupsSection.includes('const dependentLabel = group.label ?? group.id;'));
  assert.ok(optionGroupsSection.includes('const dependencyWarnings = optionGroupRoutingIssues.filter((message) => message.includes(`but "${dependentLabel}" still depends on it.`));'));
  assert.ok(optionGroupsSection.includes("role=\"alert\""), "The warning must be an explicit alert, not folded into a collapsible summary");
  const returnStatement = optionGroupsSection.slice(optionGroupsSection.indexOf("return <ReviewDestinationSection"));
  const dependencyWarningIndex = returnStatement.indexOf("{dependencyWarning}");
  const localRouteControlsIndex = returnStatement.indexOf("<LocalRouteControls");
  assert.ok(dependencyWarningIndex >= 0 && localRouteControlsIndex > dependencyWarningIndex, "{dependencyWarning} must render before (outside) the LocalRouteControls/Advanced Setup call, not nested inside its collapsible content");
});

test("9: no changes to the server-side accessory pricing parser/validator", () => {
  assert.ok(!source.includes("accessory-pricing-parser"), "The component must not import or duplicate the server-side parser/validator");
});
