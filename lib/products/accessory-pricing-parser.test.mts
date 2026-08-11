import assert from "node:assert/strict";
import test from "node:test";
import { AccessoryPricingContractError, parseAccessoryPricingJson } from "./accessory-pricing-parser.js";
import { BASE_MODEL_GROUP_PRICING_TYPE } from "./base-model-pricing-groups.js";

const variants = [{ id: "desks", pricing_type: BASE_MODEL_GROUP_PRICING_TYPE, group_name: "Desks", is_active: true, sort_order: 0, items: [{ id: "1AF003", variant_name: "Desk", price: 100 }] }];
const metadata = {
  role: "conditional_option",
  selection: "exactly_one",
  applicability: [{ base_model_group_id: "desks", base_model_row_id: "1AF003", required: true, visible: true, allowed_item_ids: ["top"] }],
};
const legacyGroup = { id: "legacy", group_name: "Accessories", group_is_required: true, is_active: true, sort_order: 0, items: [{ id: "legacy-item", item_name: "Legacy", supplier_price_list_code: "LEG", price: null, currency: "EUR", specification: "Legacy spec", is_active: true, sort_order: 0 }] };
const conditionalGroup = { ...legacyGroup, id: "top-group", group_name: "Top Access", group_is_required: false, items: [{ ...legacyGroup.items[0], id: "top", price: 0 }], conditional_configuration: metadata };

test("legacy group saves without injecting conditional metadata", () => {
  const parsed = parseAccessoryPricingJson(JSON.stringify([legacyGroup]), variants);
  assert.deepEqual(parsed, [legacyGroup]);
  assert.equal("conditional_configuration" in parsed[0], false);
  assert.equal(parsed[0].group_is_required, true);
  assert.equal(parsed[0].items?.[0].price, null);
});

test("valid conditional metadata round-trips through unrelated editor-style changes", () => {
  const parsed = parseAccessoryPricingJson(JSON.stringify([conditionalGroup]), variants);
  assert.deepEqual(parsed[0].conditional_configuration, metadata);
  const renamed = { ...parsed[0], group_name: "Renamed", items: [...(parsed[0].items ?? []), { id: "new", item_name: "New", price: 5 }] };
  renamed.items[0] = { ...renamed.items[0], price: 25, specification: "Updated" };
  const saved = parseAccessoryPricingJson(JSON.stringify([renamed]), variants);
  assert.deepEqual(saved[0].conditional_configuration, metadata);
  assert.equal(saved[0].group_name, "Renamed");
  assert.equal(saved[0].items?.[0].price, 25);
  assert.equal(saved[0].items?.[0].specification, "Updated");
  assert.equal(saved[0].items?.[1].id, "new");
});

test("malformed metadata and stale item references reject", () => {
  for (const value of [
    { ...conditionalGroup, conditional_configuration: "bad" },
    { ...conditionalGroup, conditional_configuration: { ...metadata, role: "unknown" } },
    { ...conditionalGroup, conditional_configuration: { ...metadata, selection: "unknown" } },
    { ...conditionalGroup, conditional_configuration: { ...metadata, applicability: [...metadata.applicability, ...metadata.applicability] } },
    { ...conditionalGroup, conditional_configuration: { ...metadata, applicability: [{ ...metadata.applicability[0], allowed_item_ids: ["missing"] }] } },
    { ...conditionalGroup, items: [] },
  ]) {
    assert.throws(() => parseAccessoryPricingJson(JSON.stringify([value]), variants), AccessoryPricingContractError);
  }
});

test("Base/Model group and row references must exist", () => {
  assert.doesNotThrow(() => parseAccessoryPricingJson(JSON.stringify([conditionalGroup]), variants));
  const removedRow = [{ ...variants[0], items: [] }];
  assert.throws(() => parseAccessoryPricingJson(JSON.stringify([conditionalGroup]), removedRow), (error: unknown) =>
    error instanceof AccessoryPricingContractError && error.issues.some((issue) => issue.code === "unknown_base_model_reference"));
});

test("null and zero prices remain distinct", () => {
  const parsed = parseAccessoryPricingJson(JSON.stringify([legacyGroup, conditionalGroup]), variants);
  assert.equal(parsed[0].items?.[0].price, null);
  assert.equal(parsed[1].items?.[0].price, 0);
});
