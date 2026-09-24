// GPC-3.4: human-friendly accessory / required-option labels - orchestrator side (question
// wording, Skip, button secondary line, typed matching). Static source-inspection tests, matching
// the existing lib/noa/noa-phase-gpc33-safety.test.mts convention for this file (the orchestrator
// composes server-only NOA capabilities that aren't safely importable in isolation here).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");

test("5/6. Accessory question wording is built from the step's own group label and GPC-1's required flag, not the group name/kind", () => {
  assert.ok(orchestrator.includes('case "accessory": {'));
  assert.ok(orchestrator.includes("const noun = step.label.trim().toLowerCase()"));
  assert.ok(orchestrator.includes("? { question: `Choose a required ${noun}`, noun, terminator: \".\" }"));
  assert.ok(orchestrator.includes(": { question: `Would you like to add a ${noun}`, noun, terminator: \"?\" }"));
  // Never the old unconditional generic fallback for a known accessory step.
  assert.ok(!orchestrator.match(/case "accessory":[\s\S]{0,40}"Choose an option"/));
});

test("7. Skip is still wired to optional accessory groups only (unchanged by the wording change)", () => {
  assert.ok(orchestrator.includes('includeSkip ? [...choices, { label: "Skip", value: "Skip" }] : choices'));
  assert.ok(orchestrator.includes('step.kind === "accessory" && !step.required'));
});

test("3/4/7. Secondary line renders the supplier code alongside price/currency, never replacing either", () => {
  assert.ok(orchestrator.includes("if (option.supplierCode) parts.push(option.supplierCode);"));
  assert.ok(orchestrator.includes("parts.push(`${option.priceCurrency} ${option.priceContribution.toLocaleString()}`)"));
});

test("9/10. Typed matching accepts an exact supplier code and still resolves the label/dimension paths first", () => {
  assert.ok(orchestrator.includes("const exactSupplierCode = options.find((option) => option.supplierCode"));
  assert.ok(orchestrator.includes("if (exactSupplierCode) return { kind: \"matched\", optionId: exactSupplierCode.id };"));
  // Supplier code never becomes selection identity: only option.id is written.
  assert.ok(orchestrator.includes("optionId: exactSupplierCode.id"));
});

test("8. Accessory wording has exactly one generic branch - no per-group (e.g. Top-Access/MONOLITH) hardcoding", () => {
  assert.equal((orchestrator.match(/case "accessory":/g) ?? []).length, 1);
  assert.ok(!/if\s*\(\s*step\.label/.test(orchestrator));
});
