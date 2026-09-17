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
