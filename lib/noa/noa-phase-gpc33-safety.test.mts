import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const state = readFileSync("lib/products/product-configuration-state.ts", "utf8");
const reference = readFileSync("lib/noa/noa-product-configuration-reference.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");

test("GPC-3.3 preserves each evaluated accessory group as its own required or optional step", () => {
  assert.ok(state.includes('key: `accessory:${evaluation.groupId}`'));
  assert.ok(state.includes("required: evaluation.required"));
  assert.ok(state.includes("resolved: evaluation.required ? evaluation.valid"));
  assert.ok(state.includes('"accessory"'));
  assert.ok(state.includes("evaluation.role === \"companion\""));
});

test("GPC-3.3 keeps required accessory steps ordered and optional groups pending review", () => {
  assert.ok(state.includes('"modular", "accessory"'));
  assert.ok(state.includes('step.kind === "accessory" && !step.required && !step.resolved'));
  assert.ok(state.includes("skippedAccessoryGroupIds"));
  assert.ok(reference.includes('["skippedAccessoryGroupIds", isBoundedAccessoryGroupIds]'));
});

test("GPC-3.3 maps accessory choices group-locally and exposes Skip only for optional groups", () => {
  assert.ok(orchestrator.includes('includeSkip ? [...choices, { label: "Skip", value: "Skip" }] : choices'));
  assert.ok(orchestrator.includes('step.kind === "accessory" && !step.required'));
  assert.ok(orchestrator.includes('nextStep.kind === "accessory" && !nextStep.required'));
  assert.ok(orchestrator.includes("filter(([itemId]) => !nextStep.options.some"));
  assert.ok(orchestrator.includes("[match.optionId]: 1"));
});
