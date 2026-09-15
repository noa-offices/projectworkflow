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
