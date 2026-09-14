import assert from "node:assert/strict";
import test from "node:test";
import {
  isSpecificationEnrichmentRequest,
  parseBatchSpecificationEnrichmentResult,
  parseSpecificationEnrichmentResult,
} from "./specification-enrichment-contract.js";

test("trims suggestions and converts empty strings to null", () => {
  assert.deepEqual(parseSpecificationEnrichmentResult({
    displayNameSuggestion: "  Desk  ",
    specificationSuggestion: "   ",
  }), { displayNameSuggestion: "Desk", specificationSuggestion: null });
});

test("rejects extra, invalid, and oversized result fields", () => {
  assert.equal(parseSpecificationEnrichmentResult({ displayNameSuggestion: null, specificationSuggestion: null, extra: true }), null);
  assert.equal(parseSpecificationEnrichmentResult({ displayNameSuggestion: 7, specificationSuggestion: null }), null);
  assert.equal(parseSpecificationEnrichmentResult({ displayNameSuggestion: "x".repeat(161), specificationSuggestion: null }), null);
  assert.equal(parseSpecificationEnrichmentResult({ displayNameSuggestion: null, specificationSuggestion: "x".repeat(1001) }), null);
});

test("request validation enforces bounded row and context input", () => {
  const request = {
    row: { id: "row-1", displayName: null, specification: null, supplierCodes: ["A-1"], referenceCodes: [], dimensions: null },
    context: { templateName: "Desk", groupLabel: "Models", rowType: "base_model" },
    originalImportedJsonSources: [{ id: "source-1", rawJson: "{}" }],
  };
  assert.equal(isSpecificationEnrichmentRequest(request), true);
  assert.equal(isSpecificationEnrichmentRequest({ ...request, row: { ...request.row, id: "x".repeat(201) } }), false);
});

test("batch results must exhaustively and uniquely map requested targets", () => {
  const valid = [{ targetId: "one", specificationSuggestion: " Improved " }, { targetId: "two", specificationSuggestion: null }];
  assert.deepEqual(parseBatchSpecificationEnrichmentResult(valid, ["one", "two"]), [{ targetId: "one", specificationSuggestion: "Improved" }, { targetId: "two", specificationSuggestion: null }]);
  assert.equal(parseBatchSpecificationEnrichmentResult([valid[0], valid[0]], ["one", "two"]), null);
  assert.equal(parseBatchSpecificationEnrichmentResult([...valid, { targetId: "extra", specificationSuggestion: null }], ["one", "two"]), null);
  assert.equal(parseBatchSpecificationEnrichmentResult([valid[0]], ["one", "two"]), null);
  assert.equal(parseBatchSpecificationEnrichmentResult([{ ...valid[0], extra: true }, valid[1]], ["one", "two"]), null);
});
