import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE_MODEL_GROUP_PRICING_TYPE,
  LEGACY_BASE_MODEL_GROUP_ID,
  serializeBaseModelPricingGroups,
  type BaseModelPricingGroup,
  type BaseModelPricingRow,
} from "./base-model-pricing-groups.js";
import { parseBaseModelPricingJson } from "./base-model-pricing-parser.js";
import { parseAccessoryPricingJson, AccessoryPricingContractError } from "./accessory-pricing-parser.js";
import { replaceWholeTemplateBaseModelPricing, replaceWholeTemplateBaseModelRows } from "./base-model-pricing-ui-state.js";

const dxRow: BaseModelPricingRow = { id: "oxi-q-ws-dx", variant_name: "OXI_Q Workstation DX", supplier_price_list_code: "111 623", price: 940, currency: "EUR", specification: "DX configuration.", sort_order: 0, is_active: true };
const sxRow: BaseModelPricingRow = { id: "oxi-q-ws-sx", variant_name: "OXI_Q Workstation SX", supplier_price_list_code: "111 624", price: 940, currency: "EUR", specification: "SX configuration.", sort_order: 1, is_active: true };
const flatRows = [dxRow, sxRow];

function preExistingGroup(id: string): BaseModelPricingGroup<BaseModelPricingRow>[] {
  return [{
    id,
    pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
    group_name: "Base / Model Pricing",
    is_active: true,
    sort_order: 0,
    items: [{ id: "stale-row", variant_name: "Stale", price: 1, currency: "EUR", sort_order: 0, is_active: true }],
  }];
}

test("zero pre-existing groups: flat Smart Setup replacement creates the legacy group id", () => {
  const result = replaceWholeTemplateBaseModelRows([], flatRows, LEGACY_BASE_MODEL_GROUP_ID);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, LEGACY_BASE_MODEL_GROUP_ID);
  assert.deepEqual(result[0].items.map((row) => row.id), ["oxi-q-ws-dx", "oxi-q-ws-sx"]);
});

test("one pre-existing group with a random id: flat Smart Setup replacement forces the legacy group id", () => {
  const existing = preExistingGroup("random-existing-group-id");
  const result = replaceWholeTemplateBaseModelRows(existing, flatRows, LEGACY_BASE_MODEL_GROUP_ID);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, LEGACY_BASE_MODEL_GROUP_ID, "Expected the sole existing group's random id to be replaced by the supplied legacy group id");
  assert.deepEqual(result[0].items.map((row) => row.id), ["oxi-q-ws-dx", "oxi-q-ws-sx"], "Expected row ids and order to survive unchanged");
  assert.equal(result[0].items[0].price, 940);
  assert.equal(result[0].items[0].supplier_price_list_code, "111 623");
  assert.equal(result[0].items[0].specification, "DX configuration.");
  assert.equal(result[0].group_name, "Base / Model Pricing", "Expected other group metadata to be retained, not reset");
});

test("multiple pre-existing groups: flat Smart Setup replacement still lands under the legacy group id", () => {
  const existing = [...preExistingGroup("group-one"), ...preExistingGroup("group-two")];
  const result = replaceWholeTemplateBaseModelRows(existing, flatRows, LEGACY_BASE_MODEL_GROUP_ID);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, LEGACY_BASE_MODEL_GROUP_ID);
});

test("explicit matrix-routed additional groups keep their own supplied ids, never the legacy id", () => {
  const additionalGroups: BaseModelPricingGroup<BaseModelPricingRow>[] = [{
    id: "matrix-desks",
    pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
    group_name: "Desks Matrix",
    is_active: true,
    sort_order: 1,
    items: [{ id: "desk-row", variant_name: "Desk", price: 500, currency: "EUR", sort_order: 0, is_active: true }],
  }];
  const existing = preExistingGroup("random-existing-group-id");
  const result = replaceWholeTemplateBaseModelPricing(existing, flatRows, additionalGroups, LEGACY_BASE_MODEL_GROUP_ID);
  const flatGroup = result.find((group) => group.items.some((row) => row.id === "oxi-q-ws-dx"));
  const matrixGroup = result.find((group) => group.id === "matrix-desks");
  assert.ok(flatGroup, "Expected the flat-row group to be present");
  assert.equal(flatGroup!.id, LEGACY_BASE_MODEL_GROUP_ID);
  assert.ok(matrixGroup, "Expected the explicit matrix-routed group to keep its own supplied id");
  assert.deepEqual(matrixGroup!.items.map((row) => row.id), ["desk-row"]);
});

function endToEndBaseModelPricing() {
  const existing = preExistingGroup("random-existing-group-id");
  const replaced = replaceWholeTemplateBaseModelRows(existing, flatRows, LEGACY_BASE_MODEL_GROUP_ID);
  const serialized = JSON.stringify(serializeBaseModelPricingGroups(replaced));
  return parseBaseModelPricingJson(serialized);
}

function conditionalAccessoryGroupFor(rowId: string) {
  return [{
    id: "top-access",
    group_name: "Top Access",
    group_is_required: false,
    is_active: true,
    sort_order: 0,
    items: [{ id: "top", item_name: "Top Access Panel", supplier_price_list_code: "TOP-01", price: 0, currency: "EUR", specification: "", is_active: true, sort_order: 0 }],
    conditional_configuration: {
      role: "conditional_option",
      selection: "exactly_one",
      applicability: [{ target: { kind: "base_model", group_id: LEGACY_BASE_MODEL_GROUP_ID, row_id: rowId }, required: true, visible: true }],
    },
  }];
}

test("end-to-end: DX target validates through serialize -> parse -> accessory validation", () => {
  const baseModelPricing = endToEndBaseModelPricing();
  assert.doesNotThrow(() => parseAccessoryPricingJson(JSON.stringify(conditionalAccessoryGroupFor("oxi-q-ws-dx")), baseModelPricing));
});

test("end-to-end: SX target validates through serialize -> parse -> accessory validation", () => {
  const baseModelPricing = endToEndBaseModelPricing();
  assert.doesNotThrow(() => parseAccessoryPricingJson(JSON.stringify(conditionalAccessoryGroupFor("oxi-q-ws-sx")), baseModelPricing));
});

test("negative: an unknown row id under the correct legacy group still rejects", () => {
  const baseModelPricing = endToEndBaseModelPricing();
  assert.throws(
    () => parseAccessoryPricingJson(JSON.stringify(conditionalAccessoryGroupFor("oxi-q-ws-unknown")), baseModelPricing),
    (error: unknown) => error instanceof AccessoryPricingContractError && error.issues.some((issue) => issue.code === "unknown_base_model_reference"),
  );
});

test("negative: the correct row id under the stale pre-fix random group id still rejects", () => {
  const baseModelPricing = endToEndBaseModelPricing();
  const staleTargetGroup = [{
    ...conditionalAccessoryGroupFor("oxi-q-ws-dx")[0],
    conditional_configuration: {
      role: "conditional_option" as const,
      selection: "exactly_one" as const,
      applicability: [{ target: { kind: "base_model" as const, group_id: "random-existing-group-id", row_id: "oxi-q-ws-dx" }, required: true, visible: true }],
    },
  }];
  assert.throws(
    () => parseAccessoryPricingJson(JSON.stringify(staleTargetGroup), baseModelPricing),
    (error: unknown) => error instanceof AccessoryPricingContractError && error.issues.some((issue) => issue.code === "unknown_base_model_reference"),
  );
});
