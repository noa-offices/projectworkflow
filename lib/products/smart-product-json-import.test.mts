import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SMART_PRODUCT_JSON_BYTES, parseSmartProductJsonImport } from "./smart-product-json-import.js";

function draft(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1, template: { templateName: "UAT Desk" }, defaultCurrency: "EUR",
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [], ...overrides,
  });
}

test("malformed, oversized, and unsupported-version JSON do not reach review", () => {
  assert.equal(parseSmartProductJsonImport("{").kind, "invalid_json");
  assert.equal(parseSmartProductJsonImport("x".repeat(MAX_SMART_PRODUCT_JSON_BYTES + 1)).kind, "oversized");
  assert.equal(parseSmartProductJsonImport(draft({ version: 2 })).kind, "validation");
});

test("valid workstation, base, matrix, modular, and options drafts reach review without changing prices", () => {
  const result = parseSmartProductJsonImport(draft({
    pricing: {
      workstationRows: [{ id: "desk", label: "Desk", price: null, additionalPrice: 0 }],
      baseModelRows: [{ id: "base", label: "Base", price: 0 }],
      priceMatrices: [{ id: "fabric", columns: [{ id: "a", label: "A" }], rows: [{ id: "seat", prices: { a: null } }] }],
      modularGroups: [{ id: "modular", matrix: { id: "modules", columns: [{ id: "a", label: "A" }], rows: [{ id: "module", prices: { a: 0 } }] } }],
    },
    optionGroups: [{ id: "power", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: ["socket"] }, items: [{ id: "socket", price: 0 }] }],
  }));
  assert.equal(result.kind, "valid");
  if (result.kind !== "valid") return;
  assert.equal(result.validation.draft?.pricing.workstationRows[0].price, null);
  assert.equal(result.validation.draft?.pricing.workstationRows[0].additionalPrice, 0);
  assert.equal(result.validation.draft?.pricing.priceMatrices[0].rows[0].prices.a, null);
  assert.equal(result.validation.draft?.pricing.modularGroups[0].matrix!.rows[0].prices.a, 0);
});

test("strict-valid JSON is never repaired and carries no repaired marker", () => {
  const result = parseSmartProductJsonImport(draft());
  assert.equal(result.kind, "valid");
  if (result.kind !== "valid") return;
  assert.equal(result.repaired, undefined, "Expected already-valid JSON to skip the repair path entirely");
});

test("a pasted response wrapped in a Markdown fence is repaired and reaches review", () => {
  const result = parseSmartProductJsonImport("```json\n" + draft() + "\n```");
  assert.equal(result.kind, "valid");
  if (result.kind !== "valid") return;
  assert.deepEqual(result.repaired, ["markdown_fence"]);
});

test("a trailing comma plus an invalid \\_ escape are both repaired in one pass", () => {
  const withDefects = draft()
    .replace('"UAT Desk"', '"OXI\\_P"')
    .replace('"sources":[]', '"sources":[],');
  const result = parseSmartProductJsonImport(withDefects);
  assert.equal(result.kind, "valid");
  if (result.kind !== "valid") return;
  assert.ok(result.repaired?.includes("invalid_underscore_escape"));
  assert.ok(result.repaired?.includes("trailing_comma"));
  assert.equal(result.validation.draft?.template.templateName, "OXI_P");
});

test("an unrepairable syntax error still returns the original generic invalid_json message", () => {
  const result = parseSmartProductJsonImport("{not json at all");
  assert.equal(result.kind, "invalid_json");
  if (result.kind !== "invalid_json") return;
  assert.match(result.message, /Invalid JSON/);
});

test("repair never changes a commercial value: unit price survives a trailing-comma repair unchanged", () => {
  const withTrailingComma = draft({
    pricing: {
      workstationRows: [],
      baseModelRows: [{ id: "art-058", label: "ART.058", price: 69, currency: "EUR", supplierCodes: ["111 058"] }],
      priceMatrices: [], modularGroups: [],
    },
  }).replace('"supplierCodes":["111 058"]', '"supplierCodes":["111 058"],');
  const result = parseSmartProductJsonImport(withTrailingComma);
  assert.equal(result.kind, "valid");
  if (result.kind !== "valid") return;
  assert.ok(result.repaired?.includes("trailing_comma"));
  assert.equal(result.validation.draft?.pricing.baseModelRows[0].price, 69, "Expected the real unit price to survive syntax repair unchanged");
});
