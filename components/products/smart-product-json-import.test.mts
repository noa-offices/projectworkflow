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
