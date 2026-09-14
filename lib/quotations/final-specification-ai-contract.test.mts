import assert from "node:assert/strict";
import test from "node:test";
import {
  parseFinalSpecificationRequest,
  parseFinalSpecificationResult,
} from "./final-specification-ai-contract.js";

const request = {
  currentSpecification: " Current ",
  productName: " Desk ",
  selectedModel: "M1",
  selectedDimensions: "1600 x 800",
  selectedFinishLabels: ["Oak"],
  selectedOptionLabels: ["Cable tray"],
  selectedAccessoryLabels: ["Screen"],
  selectedCompanionLabels: [],
  selectedRowFacts: ["Steel frame"],
};

test("validates and trims a compact request", () => {
  assert.deepEqual(parseFinalSpecificationRequest(request), {
    ...request,
    currentSpecification: "Current",
    productName: "Desk",
  });
  assert.equal(parseFinalSpecificationRequest({ ...request, price: 100 }), null);
});

test("trims results, maps empty to null, and ignores untrusted extra fields", () => {
  assert.deepEqual(parseFinalSpecificationResult({ specificationSuggestion: "  Improved  ", ignored: "value" }), {
    specificationSuggestion: "Improved",
  });
  assert.deepEqual(parseFinalSpecificationResult({ specificationSuggestion: "  " }), { specificationSuggestion: null });
});

test("rejects malformed and oversized provider output safely", () => {
  assert.equal(parseFinalSpecificationResult({ specificationSuggestion: 7 }), null);
  assert.equal(parseFinalSpecificationResult({ specificationSuggestion: "x".repeat(1501) }), null);
  assert.equal(parseFinalSpecificationResult(null), null);
});
