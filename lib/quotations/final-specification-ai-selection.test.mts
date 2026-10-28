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

test("the copy of the specification sent to the AI loses the Dimension line and the brand and country line, nothing else", async () => {
  const { specificationForAi } = await import("./final-specification-ai-selection");
  const text = "Task chair, mesh back, castors.\nINTERSTUHL – GERMANY\nDimension: W:520/680 D:615 H:1140 mm";
  assert.equal(specificationForAi(text, { brand: "INTERSTUHL", origin: "GERMANY" }), "Task chair, mesh back, castors.");
  assert.equal(specificationForAi("Task chair.\nInterstuhl - Germany\n  dimension: W:1 mm", { brand: "INTERSTUHL", origin: "Germany" }), "Task chair.");
  assert.equal(specificationForAi("Task chair.\nGERMANY", { brand: "INTERSTUHL", origin: "GERMANY" }), "Task chair.");
  assert.equal(specificationForAi("Desk made in Germany by Interstuhl.\nSteel frame.", { brand: "INTERSTUHL", origin: "GERMANY" }), "Desk made in Germany by Interstuhl.\nSteel frame.", "other lines stay as they are");
  assert.equal(specificationForAi("Steel frame.", {}), "Steel frame.");
  assert.equal(specificationForAi(null, { brand: "X" }), null);
});

test("the Product Library sends no finishes, brand or origin to the AI", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  const start = source.indexOf("const finalSpecificationAiRequest = buildFinalSpecificationRequest({");
  const block = source.slice(start, source.indexOf("});", source.indexOf("selectedRowFacts", start)));
  assert.ok(start > 0);
  assert.match(block, /finishes: \[\],/);
  assert.doesNotMatch(block, /selectedFinishSummary|selectedFabricCategory/);
  assert.doesNotMatch(block, /Brand: |Origin: /);
  assert.doesNotMatch(block.replace(/currentSpecification: specificationForAi\([^\n]*\n/, ""), /brandNameById|originSnapshot/, "brand and origin appear only inside the strip helper call");
  assert.match(block, /specificationForAi\(finalSpecification/);
});

test("the Final Specification control has Improve and Shorten buttons, checks the answer, and Use suggestion keeps the Dimension line", async () => {
  const { readFileSync } = await import("node:fs");
  const control = readFileSync("components/quotations/final-specification-ai-control.tsx", "utf8");
  assert.match(control, /\["improve", "shorten"\] as const/);
  assert.match(control, /runFinalSpecificationImprovement\(\{ \.\.\.request, mode \}\)/);
  assert.match(control, /checkFinalSpecificationSuggestion\(/);
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.match(selector, /keepDimensionLine\(finalSpecification \?\? null, specification\)/);
});
