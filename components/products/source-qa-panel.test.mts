import assert from "node:assert/strict";
import test from "node:test";
import { sourceQaAiIssueDetails } from "./source-qa-panel.js";

const issue = { id: "issue", type: "price_value_mismatch" as const, severity: "critical" as const, confidence: "high" as const, supplierModelCode: "9MU201", sourcePage: 1, sourceEvidence: "Fabric Cat. D-E 5800", sourceValue: 5800, jsonLocation: "pricing.priceMatrices[0].rows[0]", jsonValue: 5700, explanation: "Price differs." };

test("returns all present Source QA AI issue evidence fields", () => {
  assert.deepEqual(sourceQaAiIssueDetails(issue), [["Code", "9MU201"], ["Page", 1], ["Source", "Fabric Cat. D-E 5800"], ["Source value", 5800], ["JSON value", 5700], ["JSON location", "pricing.priceMatrices[0].rows[0]"]]);
});

test("omits null optional Source QA AI issue evidence fields safely", () => {
  assert.deepEqual(sourceQaAiIssueDetails({ ...issue, supplierModelCode: null, sourcePage: null, sourceEvidence: null, sourceValue: null, jsonLocation: null, jsonValue: null }), []);
});
