import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedFinalSpecificationSuggestion,
  buildFinalSpecificationRequest,
  finalSpecificationRequestFingerprint,
} from "./final-specification-ai-selection.js";

test("compact payload includes only actual selected values", () => {
  const optionCandidates = [
    { label: "Cable tray", selected: true },
    { label: "Power module", selected: false, price: 999, currency: "AED", code: "SECRET" },
  ];
  const request = buildFinalSpecificationRequest({
    currentSpecification: "Current",
    productName: "Desk",
    selectedModel: "Model A",
    selectedDimensions: "1600 x 800",
    finishes: [{ label: "Oak", selected: true }, { label: "Walnut", selected: false }],
    options: optionCandidates,
    accessories: [{ label: "Screen", quantity: 1 }, { label: "Drawer", quantity: 0 }],
    companions: [{ label: "Return desk", quantity: 1 }, { label: "Pedestal", quantity: 0 }],
    selectedRowFacts: ["Steel frame"],
  });
  assert.deepEqual(request.selectedFinishLabels, ["Oak"]);
  assert.deepEqual(request.selectedOptionLabels, ["Cable tray"]);
  assert.deepEqual(request.selectedAccessoryLabels, ["Screen"]);
  assert.deepEqual(request.selectedCompanionLabels, ["Return desk"]);
  const serialized = JSON.stringify(request);
  assert.doesNotMatch(serialized, /Walnut|Power module|Drawer|Pedestal|999|AED|SECRET/);
  assert.doesNotMatch(serialized, /price|currency|code/i);
});

test("edited suggestion is trimmed and safely bounded before apply", () => {
  assert.equal(acceptedFinalSpecificationSuggestion("  Edited wording  "), "Edited wording");
  assert.equal(acceptedFinalSpecificationSuggestion("   "), null);
  assert.equal(acceptedFinalSpecificationSuggestion("x".repeat(1501)), null);
});

test("relevant selection and current text changes invalidate the fingerprint", () => {
  const base = buildFinalSpecificationRequest({ productName: "Desk", currentSpecification: "One" });
  const changedText = buildFinalSpecificationRequest({ productName: "Desk", currentSpecification: "Two" });
  const changedSelection = buildFinalSpecificationRequest({ productName: "Desk", currentSpecification: "One", options: [{ label: "Tray", selected: true }] });
  assert.notEqual(finalSpecificationRequestFingerprint(base), finalSpecificationRequestFingerprint(changedText));
  assert.notEqual(finalSpecificationRequestFingerprint(base), finalSpecificationRequestFingerprint(changedSelection));
});
