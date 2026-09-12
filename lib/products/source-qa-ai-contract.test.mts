import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceQaAiReport } from "./source-qa-ai-contract.js";

const report = { version: 1, summary: { issueCount: 1, highSeverityCount: 1, reviewRequired: true }, issues: [{ id: "issue-1", type: "price_value_mismatch", severity: "critical", confidence: "high", supplierModelCode: "A-1", sourcePage: 2, sourceEvidence: "A-1 100", sourceValue: 100, jsonLocation: "pricing.baseModelRows[0].price", jsonValue: 120, explanation: "Source price differs." }] } as const;

test("accepts the strict Source QA AI report contract", () => {
  assert.deepEqual(parseSourceQaAiReport(report), report);
});

test("rejects invalid Source QA AI issue values", () => {
  assert.equal(parseSourceQaAiReport({ ...report, issues: [{ ...report.issues[0], type: "unknown" }] }), null);
});
