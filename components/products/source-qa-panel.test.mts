import assert from "node:assert/strict";
import test from "node:test";
import { sourceQaAiDisplaySeverity, sourceQaAiIssueDetails, sourceQaAiIssueGroups, sourceQaAiIssueLabel, sourceQaAiSummary } from "./source-qa-panel.js";

const issue = { id: "issue", type: "price_value_mismatch" as const, severity: "critical" as const, confidence: "high" as const, supplierModelCode: "9MU201", sourcePage: 1, sourceEvidence: "Fabric Cat. D-E 5800", sourceValue: 5800, jsonLocation: "pricing.priceMatrices[0].rows[0]", jsonValue: 5700, explanation: "Price differs." };

test("returns all present Source QA AI issue evidence fields", () => {
  assert.deepEqual(sourceQaAiIssueDetails(issue), [["Code", "9MU201"], ["Page", 1], ["Source", "Fabric Cat. D-E 5800"], ["Source value", 5800], ["JSON value", 5700], ["JSON location", "pricing.priceMatrices[0].rows[0]"]]);
});

test("omits null optional Source QA AI issue evidence fields safely", () => {
  assert.deepEqual(sourceQaAiIssueDetails({ ...issue, supplierModelCode: null, sourcePage: null, sourceEvidence: null, sourceValue: null, jsonLocation: null, jsonValue: null }), []);
});

test("groups related issues, retains unrelated rows, and deduplicates display rows without mutation", () => {
  const issues = [issue, { ...issue, id: "code", type: "supplier_model_code_mismatch" as const }, { ...issue, id: "other", supplierModelCode: "9MU202" }, { ...issue, id: "duplicate" }];
  const before = structuredClone(issues);
  const groups = sourceQaAiIssueGroups(issues);
  assert.equal(groups.length, 2); assert.equal(groups[0].issues.length, 2); assert.deepEqual(issues, before);
});

test("uses safe fallback grouping, readable labels, and severity summary", () => {
  const uncoded = { ...issue, id: "uncoded", supplierModelCode: null, sourcePage: 3, jsonLocation: "pricing.priceMatrices[0].rows[1].prices.open", severity: "warning" as const };
  const info = { ...issue, id: "info", supplierModelCode: "9MU203", severity: "info" as const };
  const summary = sourceQaAiSummary([issue, uncoded, info]);
  assert.equal(summary.groups.length, 3); assert.equal(summary.findings, 3); assert.deepEqual(summary.counts, { critical: 1, warning: 1, info: 1 }); assert.equal(summary.status, "REVIEW REQUIRED"); assert.equal(sourceQaAiIssueLabel(uncoded), "Price mismatch");
});

test("keeps equal-value price findings visible as review items and sorts findings", () => {
  const equal = { ...issue, id: "equal", sourceValue: 6430, jsonValue: 6430, explanation: "Row binding needs review." };
  const code = { ...issue, id: "code", type: "supplier_model_code_mismatch" as const };
  const category = { ...issue, id: "category", type: "row_binding_mismatch" as const };
  const before = structuredClone([equal, code, category]); const groups = sourceQaAiIssueGroups([equal, category, code]);
  assert.equal(sourceQaAiIssueLabel(equal), "Row/code binding issue"); assert.deepEqual(groups[0].issues.map((entry) => entry.id), ["code", "category", "equal"]); assert.deepEqual([equal, code, category], before);
});

test("renders equal-value review items neutrally without changing their report severity", () => {
  const review = { ...issue, id: "review", sourceValue: 6430, jsonValue: 6430, explanation: "Formatting only." };
  const before = structuredClone(review); const summary = sourceQaAiSummary([review]);
  assert.equal(sourceQaAiIssueLabel(review), "Review item"); assert.equal(sourceQaAiDisplaySeverity(review), "review"); assert.deepEqual(summary.counts, { critical: 0, warning: 0, info: 0 }); assert.equal(review.severity, "critical"); assert.deepEqual(review, before);
  assert.equal(sourceQaAiDisplaySeverity(issue), "critical");
});
