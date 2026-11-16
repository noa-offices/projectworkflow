import assert from "node:assert/strict";
import test from "node:test";
import { modelApplicabilityRules } from "./smart-product-connected-options.js";
import { rebuildApplicableModelRules } from "./smart-product-option-relationships.js";

test("All Models ignores preserved connections in its guard and model-only states", () => {
  const model = { baseModelGroupId: "models", baseModelRowId: "one", required: false };
  const connection = { target: { kind: "option_item" as const, group_id: "panels", row_id: "one" }, required: false, visible: true };
  const rules = rebuildApplicableModelRules({ role: "accessory", selection: "optional_multiple", rules: [model, connection] }, [{ key: "base_model\u0000models\u0000one", target: { kind: "base_model", group_id: "models", row_id: "one" } }], new Set());
  assert.deepEqual(rules, [connection]);
  assert.equal(rules[0], connection);
  assert.equal(modelApplicabilityRules(rules).length, 0, "no remaining model rules: All Models succeeds and is pressed");
  assert.deepEqual(modelApplicabilityRules([model]), [model], "model-only state is unchanged");
  assert.deepEqual(modelApplicabilityRules([model, connection]), [model]);
  const unsupported = { target: { kind: "workstation" as const, group_id: "workstations", row_id: "one" }, required: false };
  assert.deepEqual(modelApplicabilityRules([connection, unsupported]), [unsupported], "unmanaged model rules still block All Models");
});

test("All Models proceeds with only connected options but blocks an unresolved model target", () => {
  const connection = { target: { kind: "option_item" as const, group_id: "panels", row_id: "one" }, required: false, visible: true };
  const unresolved = { target: { kind: "base_model" as const, group_id: "missing-group", row_id: "missing-row" }, required: false, visible: true };
  const allModels = (rules: Array<typeof connection | typeof unresolved>) => rebuildApplicableModelRules({ role: "accessory", selection: "optional_multiple", rules }, [], new Set());
  const connectedOnly = allModels([connection]);
  assert.deepEqual(connectedOnly, [connection]);
  assert.equal(modelApplicabilityRules(connectedOnly).length, 0, "All Models proceeds with zero model rules");
  const withMissingModel = allModels([connection, unresolved]);
  assert.deepEqual(withMissingModel, [connection, unresolved], "unresolved rule must survive so it cannot bypass the guard");
  assert.deepEqual(modelApplicabilityRules(withMissingModel), [unresolved], "remaining unresolved model target blocks All Models");
});
