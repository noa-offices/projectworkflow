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
