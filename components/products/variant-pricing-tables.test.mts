import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("accessory editor retains and edits the optional dimension field", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["dimension?: string", "dimension: row.dimension?.trim() ?? \"\"", "<th className=\"px-2 py-2\">Dimension</th>", "value={item.dimension ?? \"\"}", "updateItem(groupIndex, itemIndex, { dimension: e.target.value })"].forEach((expected) => assert.ok(source.includes(expected)));
});

test("pricing editors keep important requirements separate and normalize one line per value", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["function ImportantRequirementsTextarea", "One requirement per line", "reviewImportantRequirements(next)", "value={row.importantRequirements}", "value={normalizedRow.importantRequirements}", "value={item.importantRequirements}", "{ importantRequirements }"] .forEach((expected) => assert.ok(source.includes(expected)));
});

test("accessory editor replacement state retains category definitions and price maps", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  [
    "row.price_categories?.length ? { price_categories: row.price_categories.map((category) => ({ ...category })) }",
    "row.prices ? { prices: Object.fromEntries(Object.entries(row.prices)",
    "setGroups(normalizeAccessoryGroups(replacementGroups))",
    "(group.price_categories ?? []).length",
    "item.prices?.[category.id] ?? \"\"",
    'name="accessory_pricing" value={serialized}',
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected category accessory editor handoff: ${expected}`));
});

test("conditional configuration editor includes workstation applicability choices", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(source.includes("applicabilityTargetChoices(baseModelGroups, categoryPricingGroups, modularPricingGroups, workstationPricingGroups)"));
  assert.ok(source.includes("workstationPricingGroups={workstationPricingGroups}"));
});

test("direct Modular groups retain scalar rows, roles, composition, and no fallback categories", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["function normalizeDirectModularRow", "price: parseNullablePricingNumber(row.price)", "modular_role:", "const direct = isDirectModularPricingGroup(sourceGroup)", "price_categories: direct ? [] : priceCategories", 'modular_pricing_mode: "direct"', "modular_composition: sourceGroup.modular_composition"].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular preservation: ${expected}`));
});

test("Direct Modular editor exposes scalar price and editable role without Matrix cells", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["const directGroup = isDirectModularPricingGroup(group)", "Direct Price", "aria-label=\"Modular Role\"", "<option value=\"starter\">Starter</option>", "<option value=\"intermediate\">Intermediate</option>", "<option value=\"terminal\">Terminal</option>", "modular_role: e.target.value || undefined"].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular editor control: ${expected}`));
});

test("Direct Modular rows collapse verbose metadata and use a synchronized real-table scrollbar", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["function SyncedHorizontalScrollContainer", "primaryRef", "stickyRef", "onScroll={syncPrimary}", "onScroll={syncSticky}", "ResizeObserver(measure)", "window.addEventListener(\"scroll\", measure, true)", "group.getBoundingClientRect()", "viewportVisible", "fixed bottom-20", "hasOverflow", "expandedRowByGroup", "Edit / Details", "Hide details", "<ImportantRequirementsTextarea value={normalizedRow.importantRequirements}", "<SyncedHorizontalScrollContainer>"].forEach((expected) => assert.ok(source.includes(expected), `Expected compact detail/scroll behavior: ${expected}`));
});

test("all pricing-table editors reuse the floating scrollbar wrapper without changing their table data paths", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok((source.match(/<SyncedHorizontalScrollContainer>/g) ?? []).length >= 4);
  ["name=\"variant_pricing\" value={serialized}", "name=\"category_pricing\" value={serialized}", "name=\"modular_item_pricing\" value={serialized}", "name=\"accessory_pricing\" value={serialized}"].forEach((expected) => assert.ok(source.includes(expected), `Expected preserved editor serialization: ${expected}`));
});

test("Matrix and Accessory rows keep commercial pricing visible while collapsing verbose metadata", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["expandedCategoryRowByGroup", "Edit / Details", "groupPriceCategories.map((category)", "unavailable_categories", "<details><summary", "item.prices?.[category.id]", "<ImportantRequirementsTextarea value={item.importantRequirements}"].forEach((expected) => assert.ok(source.includes(expected), `Expected compact Matrix/Accessory behavior: ${expected}`));
});
