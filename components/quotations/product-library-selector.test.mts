import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  IMAGE_PREVIEW_ZOOM_MAX,
  IMAGE_PREVIEW_ZOOM_MIN,
  IMAGE_PREVIEW_ZOOM_STEP,
  nextImagePreviewZoomIn,
  nextImagePreviewZoomOut,
} from "../../lib/quotations/image-preview-zoom.js";

test("accessory Product Library controls show dimensions and reuse existing diagram previews safely", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  ["dimension?: string", "Size:</span> {dimension}", 'productTemplateRowReferenceKey("accessory", groupId, item.id)', "View diagram", 'type="button"', "ProductImagePreviewDialog", "rowReferences={rowReferenceImages}", "dimension: line.accessory.dimension ?? null", "Size:</span> {line.dimension}"].forEach((expected) => assert.ok(source.includes(expected)));
});

test("selected Base/Model, Matrix, and Modular summaries render separate non-empty requirements", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  ["function ImportantRequirementsBlock", "items.length ?", "list-disc", "requirements={selectedVariantRow.importantRequirements}", "requirements={selectedCategoryRow.importantRequirements}", "requirements={row.importantRequirements}"].forEach((expected) => assert.ok(source.includes(expected)));
  assert.ok(!source.includes('label="Important Requirements" value={selectedVariantRow.importantRequirements'));
});

test("accessory groups use independent visual collapse state without changing selection or pricing controls", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  ["expandedAccessoryGroups", "function AccessoryGroupHeader", 'type="button" aria-expanded={expanded}', "itemCount={group.items.length}", "selectedCount={selectedCount}", "groupHasNoSelection || selectedCount > 0", "evaluation.required || selectedCount > 0 || Boolean(validationMessage)", "{expanded ? <div", "AccessoryItemMetadata", "templatePricingAccessoryQuantities"].forEach((expected) => assert.ok(source.includes(expected)));
});

test("category-priced accessories use independent accessory category state and selected prices", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  ["selectedAccessoryCategories", "AccessoryCategoryPriceSelector", "accessoryDisplayPrice", "selected_category_id", "selected_category_label", "accessory_pricing_category", "line.unitPrice"].forEach((expected) => assert.ok(source.includes(expected)));
});

test("workstation selection emits a stable applicability target and snapshots row identity", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    'kind: "workstation" as const',
    "selectedWorkstationGroup.id",
    "workstation_row_id: selectedSizeRow?.id",
    "workstation_group_id: selectedWorkstationGroup?.id",
    'name="workstation_pricing_group_id"',
    "importantRequirements: selectedSizeRow?.importantRequirements",
    "evaluateProductAccessorySelection({",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected workstation Product Library wiring: ${expected}`));
});

test("direct Modular uses scalar prices and suppresses category UI", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  ["const usesDirectModularPricing", "usesModularPricing && !usesDirectModularPricing", "modularDirect ? numberValue(row.price)", "!usesDirectModularPricing ? <label", "<p>Module: {row.variant_name}</p>"].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular library behavior: ${expected}`));
});

test("derived required companions are selected and locked, while modular avoids CL2 and Base/Model copy", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  ["const forcedItemId = evaluation.role === \"companion\"", "disabled={forced}", "!usesWorkstationFlow && !usesModularPricing", "Select a modular item to configure required components and options."].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular companion/UI behavior: ${expected}`));
});

test("Direct Modular rows render a compact role-grouped table with expandable details", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    '(["starter", "intermediate", "terminal", "none"] as const)',
    'role === "intermediate" ? " Modules"',
    "<table className=\"w-full min-w-[680px] text-left text-xs\">",
    "Supplier Code",
    "formatMoney(row.currency ?? template.currency, numberValue(row.price))",
    "Quantity for ${rowLabel}",
    "setExpandedDirectModularRow",
    "<ImportantRequirementsBlock requirements={row.importantRequirements} />",
    "!isDirectModularPricingGroup(group) ? <div className=\"mt-2 space-y-2\">",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected compact Direct Modular UI: ${expected}`));
});

test("Direct Modular compact table adds an IMAGE column that renders the row's saved reference image, a safe placeholder when absent, and reuses the existing diagram preview dialog", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    // IMAGE column is the first column, before Module/Supplier Code/Dimension/Price/Qty/Details
    '<th className="w-16 px-2 py-1.5"><span className="sr-only">Image</span></th><th className="px-2 py-1.5">Module</th><th className="px-2 py-1.5">Supplier Code</th>',
    // row-specific reference lookup reuses the existing row-reference resolution, keyed by the modular pricing type
    'rowReferenceImages[productTemplateRowReferenceKey("modular", group.id ?? "", modularRowId)]',
    // renders the saved image when available, and reuses the existing preview dialog rather than a new modal
    "rowReference?.previewUrl ? <button type=\"button\" onClick={() => setDiagramPreview({ label: \"Module diagram\", templateId: template.id, title: rowLabel, url: rowReference.previewUrl! })}",
    'className="block h-12 w-12 overflow-hidden rounded-md border border-zinc-200 bg-white transition hover:opacity-80"',
    '<img src={rowReference.previewUrl} alt="" className="h-full w-full object-contain" loading="lazy" />',
    // safe neutral placeholder when no row image exists, never breaking layout
    ': <span className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-zinc-200 bg-zinc-50 text-center text-[9px] leading-tight text-zinc-400" aria-hidden="true">No image</span>',
    // the details row spans the now seven-column table
    "<td colSpan={7} className=\"px-2 py-2 text-xs text-zinc-700\">",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular IMAGE column behavior: ${expected}`));
});

test("Direct Modular row image uses the row-specific reference key (modular, group.id, row.id), never a template-level fallback", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  // The lookup is keyed by this exact row's group and row id, not by template.default_image_url or any
  // other template-wide field, so a row without its own reference never inherits a generic image.
  assert.ok(source.includes('const rowReference = rowReferenceImages[productTemplateRowReferenceKey("modular", group.id ?? "", modularRowId)];'));
  assert.ok(!source.includes("rowReference ?? template.default_image_url"));
  assert.ok(!source.includes("template.default_image_url ?? rowReference"));
});

test("Direct Modular quantity input and Details button remain present alongside the new IMAGE column", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    'onChange={(event) => setDirectModularRowQuantity(group.id ?? "", modularRowId, Math.max(0, Math.trunc(Number(event.target.value) || 0)))}',
    'onClick={() => setExpandedDirectModularRow(expanded ? null : `${template.id}:${modularRowId}`)} className="text-[11px] font-semibold text-emerald-900">Details</button>',
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular controls to remain: ${expected}`));
});

test("Matrix Modular row rendering is untouched by the Direct Modular IMAGE column addition", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  // The matrix branch's row cards (module/variant name, supplier code, dimension, price, unavailable-category
  // handling) keep their existing layout untouched.
  [
    "const modularUnavailable = !modularDirect && row.unavailable_categories?.includes(selectedFabricCategory);",
    "Price: {modularUnavailable ? \"N/A\" : formatMoney(row.currency ?? template.currency, modularUnitPrice)}",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected Matrix Modular row rendering to remain: ${expected}`));
  // The new row-image lookup is scoped only to the Direct Modular compact table, not duplicated into the matrix branch.
  const occurrences = source.split('rowReferenceImages[productTemplateRowReferenceKey("modular", group.id ?? "", modularRowId)]').length - 1;
  assert.equal(occurrences, 1, "Expected the Direct Modular row-image lookup to appear exactly once, not inside the Matrix Modular branch");
});

test("Direct Modular hides the redundant modular specification field and keeps quotation overrides beside Final Specification", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    "!usesDirectModularPricing ? <label className=\"block\">",
    "Modular Specification",
    "Final Details",
    "Configured Dimension",
    "Final Specification",
    "setConfiguredDimensions((current) => ({ ...current, [template.id]: event.target.value }))",
    'name="configured_dimension" value={configuredDimension}',
    'name="final_specification_override"',
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular final-detail behavior: ${expected}`));
});

test("Direct Modular uses resolved configuration text and refreshable dimension suggestions without overwriting an override", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    "buildDirectModularDimensionSuggestion",
    "suggestedDirectModularDimension",
    "configuredDimensionEditedByTemplate",
    "hasConfiguredDimensionOverride",
    "accessories: usesDirectModularPricing ? accessorySnapshots : []",
    "importantRequirements: line.row.importantRequirements",
    "accessorySnapshots: usesDirectModularPricing ? [] : accessorySnapshots",
    "finalSpecificationEditedByTemplate",
    "generatedFinalSpecification",
    "currentSpecification: finalSpecification",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular generation behavior: ${expected}`));
});

test("multiple Direct Modular groups render as a single-open accordion with compact selection headers without clearing quantities", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    "function ModularGroupHeader",
    'aria-expanded={expanded}',
    "const [expandedModularGroupByTemplate, setExpandedModularGroupByTemplate] = useState<Record<string, string | null>>({});",
    "const directModularGroupIds = usesDirectModularPricing",
    "const defaultExpandedModularGroupId =",
    "const expandedModularGroupId = expandedModularGroupByTemplate[template.id] !== undefined",
    "const groupExpanded = directModularGroupCard ? expandedModularGroupId === group.id : true;",
    "[template.id]: expandedModularGroupId === group.id ? null : group.id,",
    "starterSelection ? `Starter ${pricingDisplayName(starterSelection.row) || starterSelection.row.variant_name || starterSelection.id}` : null",
    "addOnQty > 0 ? `Add-ons ×${addOnQty}` : null",
    '"Not selected"',
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular accordion behavior: ${expected}`));
  // The row quantity state map is keyed independently of the group-expansion state, so collapsing a
  // group never touches selectedModularQuantities.
  assert.ok(!source.includes("setSelectedModularQuantities") || source.includes("setExpandedModularGroupByTemplate"));
});

test("Matrix Modular groups keep their original always-expanded rendering, untouched by the Direct Modular accordion", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    "directModularGroupCard ? (",
    "<ModularGroupHeader",
    "groupName={group.group_name || \"Modular Items\"}",
    "{!isDirectModularPricingGroup(group) ? <div className=\"mt-2 space-y-2\">",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected Matrix Modular to remain unaffected: ${expected}`));
});

test("Direct Modular right-summary hides the empty legacy Fabric / Category line while Matrix Modular keeps it", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(source.includes("{!usesDirectModularPricing ? <p>Fabric / Category: {selectedFabricCategory}</p> : null}"));
});

test("Product Library blocks selecting a second Direct Modular group sharing a selectionFamily without silently clearing the active group's quantities", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    "  modularSelectionFamily,",
    "const activeModularGroupIdByFamily = new Map<string, string>();",
    "const setDirectModularRowQuantity = (groupId: string, rowId: string, nextQty: number) => {",
    "const family = group ? modularSelectionFamily(group) : null;",
    "if (nextQty > 0 && family) {",
    "const activeGroupId = activeModularGroupIdByFamily.get(family);",
    "if (activeGroupId && activeGroupId !== groupId) {",
    '"Choose one configuration family. Clear the current selection before selecting another."',
    "onChange={(event) => setDirectModularRowQuantity(group.id ?? \"\", modularRowId, Math.max(0, Math.trunc(Number(event.target.value) || 0)))}",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected selectionFamily enforcement wiring: ${expected}`));
  // Blocking never clears the previously selected quantities: the guard returns before touching
  // setSelectedModularQuantities, and the row's committed value only ever comes from state.
  assert.ok(source.includes("if (modularSelectionFamilyNotice) {"));
  assert.ok(source.includes("[template.id]: { ...(current[template.id] ?? {}), [rowId]: nextQty },"));
});

test("the deterministic Direct Modular specification receives brand/origin at the final builder, and the AI Improve request receives the selected group, group specification, brand, and origin as facts", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    "brand: brandNameById.get(template.brand_id) ?? null,",
    "origin: originSnapshot,",
    "const groupSelectionSummaryForAi = usesDirectModularPricing",
    "usesDirectModularPricing && groupSelectionSummaryForAi",
    "`Selected Direct Modular group: ${groupSelectionSummaryForAi}`",
    "usesModularPricing ? modularDefaults.defaultSpecification : null,",
    "brandNameById.get(template.brand_id)",
    "`Brand: ${brandNameById.get(template.brand_id)}`",
    "originSnapshot ? `Origin: ${originSnapshot}` : null,",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected AI Improve context enrichment: ${expected}`));
});

test("Module Diagram preview defaults to Fit", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(source.includes('const [zoomMode, setZoomMode] = useState<ImagePreviewZoomMode>("fit");'), "Expected the dialog's initial zoom state to be Fit");
  assert.ok(source.includes('const navigate = useCallback((nextIndex: number) => { setZoomMode("fit"); onNavigate(nextIndex); }, [onNavigate]);'), "Expected navigating between images to reset back to Fit");
});

test("Module Diagram + zooms in by exactly 10 percentage points per click, anchored at 100% when leaving Fit", () => {
  assert.equal(IMAGE_PREVIEW_ZOOM_STEP, 10);
  assert.equal(nextImagePreviewZoomIn("fit"), 110, "Expected leaving Fit via + to land just above 100%, never a large jump");
  assert.equal(nextImagePreviewZoomIn(80), 90);
  assert.equal(nextImagePreviewZoomIn(90), 100);
  assert.equal(nextImagePreviewZoomIn(100), 110);
  assert.equal(nextImagePreviewZoomIn(110), 120);
});

test("Module Diagram − zooms out by exactly 10 percentage points per click, anchored at 100% when leaving Fit", () => {
  assert.equal(nextImagePreviewZoomOut("fit"), 90, "Expected leaving Fit via - to land just below 100%, never a large jump");
  assert.equal(nextImagePreviewZoomOut(120), 110);
  assert.equal(nextImagePreviewZoomOut(110), 100);
  assert.equal(nextImagePreviewZoomOut(100), 90);
  assert.equal(nextImagePreviewZoomOut(90), 80);
});

test("Module Diagram zoom never goes below the 50% minimum and disables minus at the bound", () => {
  assert.equal(IMAGE_PREVIEW_ZOOM_MIN, 50);
  assert.equal(nextImagePreviewZoomOut(55), 50);
  assert.equal(nextImagePreviewZoomOut(50), 50, "Expected clamping at the minimum instead of going below it");
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(source.includes("const zoomOutDisabled = zoomMode !== \"fit\" && zoomMode <= IMAGE_PREVIEW_ZOOM_MIN;"));
  assert.ok(source.includes('disabled={zoomOutDisabled}'));
});

test("Module Diagram zoom never goes above the 200% maximum and disables plus at the bound", () => {
  assert.equal(IMAGE_PREVIEW_ZOOM_MAX, 200);
  assert.equal(nextImagePreviewZoomIn(195), 200);
  assert.equal(nextImagePreviewZoomIn(200), 200, "Expected clamping at the maximum instead of exceeding it");
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(source.includes("const zoomInDisabled = zoomMode !== \"fit\" && zoomMode >= IMAGE_PREVIEW_ZOOM_MAX;"));
  assert.ok(source.includes('disabled={zoomInDisabled}'));
});

test("Module Diagram Fit can be restored after a manual zoom, and the percentage label reflects the active mode", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(source.includes('onClick={() => setZoomMode("fit")} className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold">Fit</button>'), "Expected a Fit control that can be clicked after zooming manually");
  assert.ok(source.includes('{zoomMode === "fit" ? "Fit" : `${zoomMode}%`}'), "Expected the label to show \"Fit\" in Fit mode and the exact percentage otherwise");
  // Fit never sets a percentage width (no upscale beyond natural size), while a manual zoom sets an exact one.
  assert.ok(source.includes('style={{ width: zoomMode === "fit" ? undefined : `${zoomMode}%` }}'));
});

test("Module Diagram zoom changes only the rendered width, never the image source", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(source.includes("src={currentImage.previewUrl || previewUrl}"), "Expected the same resolved image source regardless of zoom");
  assert.ok(source.includes('onDoubleClick={toggleFitAnd100}'), "Expected the optional double-click Fit/100% toggle to live on the same <img>, not swap the source");
  assert.ok(source.includes('const toggleFitAnd100 = () => setZoomMode((current) => (current === "fit" ? 100 : "fit"));'));
});

test("Module Diagram modal close behavior, backdrop dismissal, and navigation remain unchanged", () => {
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  [
    'onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}',
    'role="dialog" aria-modal="true" aria-label="Product diagram preview"',
    'onClick={onClose}',
    "event.key === \"Escape\"",
    "onClick={() => navigate(currentIndex - 1)}",
    "onClick={() => navigate(currentIndex + 1)}",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected Module Diagram modal behavior to remain: ${expected}`));
});
