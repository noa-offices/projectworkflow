import assert from "node:assert/strict";
import test from "node:test";
import { applicabilityTargetChoiceLabel, applicabilityTargetChoices } from "./applicability-target-choices.js";
import { setAccessoryApplicabilityTargets } from "./accessory-conditional-configuration-ui-state.js";

const modularGroups = [{ id: "modules", group_name: "Shared-side bookcase", is_active: true, items: [{ id: "end-left", supplier_price_list_code: "BC-L", display_name: "Left end unit", is_active: true }] }];

test("Modular rows are stable, human-readable applicability targets", () => {
  const choice = applicabilityTargetChoices([], [], modularGroups)[0];
  assert.deepEqual(choice, {
    key: "modular:modules:end-left",
    kind: "modular",
    groupId: "modules",
    rowId: "end-left",
    groupLabel: "Shared-side bookcase",
    code: "BC-L",
    displayName: "Left end unit",
  });
  assert.equal(applicabilityTargetChoiceLabel(choice), "BC-L â€” Left end unit");
});

test("Modular allowed-item applicability persists through editor state", () => {
  const [choice] = applicabilityTargetChoices([], [], modularGroups);
  const result = setAccessoryApplicabilityTargets({
    id: "accessories",
    items: [{ id: "a" }, { id: "b" }],
    conditional_configuration: { role: "conditional_option", selection: "choose_multiple", applicability: [] },
  }, [choice], new Set([choice.key]));
  assert.deepEqual(result.conditional_configuration?.applicability, [{
    target: { kind: "modular", group_id: "modules", row_id: "end-left" },
    required: false,
    visible: true,
  }]);
});
