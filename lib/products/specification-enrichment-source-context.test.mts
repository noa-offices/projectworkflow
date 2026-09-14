import assert from "node:assert/strict";
import test from "node:test";
import { matchSpecificationEnrichmentSourceContext } from "./specification-enrichment-source-context.js";

const row = {
  id: "row-1",
  displayName: "Executive Desk",
  specification: null,
  supplierCodes: ["SUP-10"],
  referenceCodes: ["REF-20"],
  dimensions: { rawText: "1800 x 800" },
};
const context = { templateName: "Desk Range", groupLabel: "Desks", rowType: "base_model" };
const source = (value: unknown) => [{ id: "source-1", rawJson: JSON.stringify(value) }];

test("matches by stable id before codes", () => {
  const result = matchSpecificationEnrichmentSourceContext(row, context, source({
    rows: [{ id: "row-1", supplierCode: "OTHER", name: "Executive Desk" }],
  }));
  assert.equal(result.kind, "matched");
  if (result.kind === "matched") assert.equal(result.match, "id");
});

test("matches exact supplier and reference codes", () => {
  const supplier = matchSpecificationEnrichmentSourceContext(row, context, source({ rows: [{ code: "SUP-10", name: "Desk" }] }));
  assert.equal(supplier.kind, "matched");
  if (supplier.kind === "matched") assert.equal(supplier.match, "supplier_code");

  const reference = matchSpecificationEnrichmentSourceContext({ ...row, supplierCodes: [] }, context, source({ rows: [{ reference: "REF-20", name: "Desk" }] }));
  assert.equal(reference.kind, "matched");
  if (reference.kind === "matched") assert.equal(reference.match, "reference_code");
});

test("returns no_context for ambiguous or absent matches", () => {
  assert.deepEqual(matchSpecificationEnrichmentSourceContext(row, context, source({ rows: [{ code: "SUP-10" }, { code: "SUP-10" }] })), { kind: "no_context" });
  assert.deepEqual(matchSpecificationEnrichmentSourceContext(row, context, source({ rows: [{ code: "OTHER" }] })), { kind: "no_context" });
});

test("matched fragment strips commercial fields", () => {
  const result = matchSpecificationEnrichmentSourceContext(row, context, source({ rows: [{ code: "SUP-10", material: "oak", price: 100, currency: "AED" }, { code: "OTHER", note: "FULL_RAW_SOURCE_SENTINEL" }] }));
  assert.equal(result.kind, "matched");
  if (result.kind === "matched") {
    const text = JSON.stringify(result.fragment);
    assert.match(text, /oak/);
    assert.doesNotMatch(text, /price|currency|100|AED/i);
    assert.doesNotMatch(text, /FULL_RAW_SOURCE_SENTINEL/);
  }
});
