import assert from "node:assert/strict";
import test from "node:test";
import { applicabilityTargetChoiceLabel, applicabilityTargetChoices } from "./applicability-target-choices.js";
import { setAccessoryApplicabilityTargets } from "./accessory-conditional-configuration-ui-state.js";

const modularGroups = [{ id: "modules", group_name: "Shared-side bookcase", is_active: true, items: [{ id: "end-left", supplier_price_list_code: "BC-L", display_name: "Left end unit", is_active: true }] }];

test("Modular rows are stable, human-readable applicability targets", () => {
  const choice = applicabilityTargetChoices([], [], modularGroups)[0];
  assert.deepEqual(choice, {
    key: "modular\u0000modules\u0000end-left",
    kind: "modular",
    groupId: "modules",
    rowId: "end-left",
    groupLabel: "Shared-side bookcase",
    code: "BC-L",
    displayName: "Left end unit",
  });
  assert.equal(applicabilityTargetChoiceLabel(choice), "BC-L \u2014 Left end unit");
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

test("Workstation rows are stable applicability targets with workstation labels and codes", () => {
  const [choice] = applicabilityTargetChoices([], [], [], [{
    id: "bench",
    group_name: "OXI Bench",
    is_active: true,
    items: [{ id: "oxi-4", label: "4 person bench", default_dimension: "2400 x 1600", base_supplier_price_list_code: "OXI-4", is_active: true }],
  }]);
  assert.deepEqual(choice, {
    key: "workstation\u0000bench\u0000oxi-4",
    kind: "workstation",
    groupId: "bench",
    rowId: "oxi-4",
    groupLabel: "OXI Bench",
    code: "OXI-4",
    displayName: "4 person bench",
  });
});
