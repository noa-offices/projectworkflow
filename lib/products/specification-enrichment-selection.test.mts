import assert from "node:assert/strict";
import test from "node:test";
import { applySpecificationEnrichmentField, specificationEnrichmentFieldPatch, specificationEnrichmentFingerprint } from "./specification-enrichment-selection.js";

const row = {
  id: "row-1",
  displayName: "Current",
  specification: "Current specification",
  supplierCodes: ["CODE-1"],
  referenceCodes: ["REF-1"],
  dimensions: { rawText: "1200 x 600" },
};

test("accepting display name changes only display name without mutation", () => {
  const before = structuredClone(row);
  const next = applySpecificationEnrichmentField(row, "displayName", "Suggested");
  assert.equal(next.displayName, "Suggested");
  assert.equal(next.specification, row.specification);
  assert.deepEqual(row, before);
});

test("accepting specification changes only specification", () => {
  const next = applySpecificationEnrichmentField(row, "specification", "Suggested specification");
  assert.equal(next.specification, "Suggested specification");
  assert.equal(next.displayName, row.displayName);
  assert.deepEqual(specificationEnrichmentFieldPatch("specification", "New"), { specification: "New" });
});

test("relevant row changes invalidate the suggestion fingerprint", () => {
  const context = { templateName: "Range", groupLabel: "Desks", rowType: "base_model" };
  const before = specificationEnrichmentFingerprint(row, context);
  assert.notEqual(before, specificationEnrichmentFingerprint({ ...row, specification: "Edited" }, context));
  assert.notEqual(before, specificationEnrichmentFingerprint(row, { ...context, groupLabel: "Meeting Tables" }));
});
