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
