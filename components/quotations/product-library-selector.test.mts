import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
    "Quantity for ${pricingDisplayName(row)",
    "setExpandedDirectModularRow",
    "<ImportantRequirementsBlock requirements={row.importantRequirements} />",
    "!isDirectModularPricingGroup(group) ? <div className=\"mt-2 space-y-2\">",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected compact Direct Modular UI: ${expected}`));
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
