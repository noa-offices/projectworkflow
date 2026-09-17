import assert from "node:assert/strict";
import test from "node:test";
import { parseBaseModelPricingJson } from "./base-model-pricing-parser.js";
import { BASE_MODEL_GROUP_PRICING_TYPE, BaseModelPricingContractError, LEGACY_BASE_MODEL_GROUP_ID, baseModelPricingGroups, flattenBaseModelPricingRows, serializeBaseModelPricingGroups, } from "./base-model-pricing-groups.js";
const row = { id: "model-a", variant_name: "A", display_name: "Model A", supplier_price_list_code: "A-01", dimension: "140 x 70", price: null, currency: "AED", specification: "Spec", is_active: true, sort_order: 0 };
test("server parser accepts legacy rows and preserves IDs, null, zero, and exact values", () => {
    const parsed = parseBaseModelPricingJson(JSON.stringify([row, { ...row, id: "zero", price: 0 }, { ...row, id: "exact", price: 123.45 }]));
    assert.deepEqual(parsed.map((item) => item.id), ["model-a", "zero", "exact"]);
    assert.deepEqual(parsed.map((item) => item.price), [null, 0, 123.45]);
});
test("server parser preserves separate trimmed, distinct important requirements", () => {
    const parsed = parseBaseModelPricingJson(JSON.stringify([{ ...row, importantRequirements: [" Finishing top required ", "", "Wall fixing required", "Finishing top required"] }]));
    assert.equal(parsed[0].specification, "Spec");
    assert.deepEqual(parsed[0].importantRequirements, ["Finishing top required", "Wall fixing required"]);
});
test("server parser accepts grouped arrays, preserves empty groups, and round-trips", () => {
    const input = [
        { id: "executive", pricing_type: BASE_MODEL_GROUP_PRICING_TYPE, group_name: "Executive", is_active: true, sort_order: 0, items: [row] },
        { id: "empty", pricing_type: BASE_MODEL_GROUP_PRICING_TYPE, group_name: "Empty", is_active: false, sort_order: 1, items: [] },
    ];
    const parsed = parseBaseModelPricingJson(JSON.stringify(input));
    assert.deepEqual(serializeBaseModelPricingGroups(baseModelPricingGroups(parsed)), parsed);
    assert.equal(flattenBaseModelPricingRows(parsed).length, 1);
    assert.equal(parsed[1].items.length, 0);
});
test("malformed groups reject safely", () => {
    assert.throws(() => parseBaseModelPricingJson(JSON.stringify([{ id: "bad", pricing_type: BASE_MODEL_GROUP_PRICING_TYPE }])), BaseModelPricingContractError);
    assert.throws(() => parseBaseModelPricingJson("{"), BaseModelPricingContractError);
});
test("legacy UI normalization saves one explicit group and preserves row identity", () => {
    const groups = baseModelPricingGroups([row]);
    assert.equal(groups[0].id, LEGACY_BASE_MODEL_GROUP_ID);
    const saved = parseBaseModelPricingJson(JSON.stringify(serializeBaseModelPricingGroups(groups)));
    assert.equal(saved[0].pricing_type, BASE_MODEL_GROUP_PRICING_TYPE);
    assert.equal(saved[0].items[0].id, "model-a");
});
test("targeted readers flatten grouped rows, select by id, calculate source price, and count items", () => {
    const grouped = [
        { id: "a", pricing_type: BASE_MODEL_GROUP_PRICING_TYPE, group_name: "A", is_active: true, sort_order: 0, items: [{ ...row, id: "a-row", price: 0 }] },
        { id: "b", pricing_type: BASE_MODEL_GROUP_PRICING_TYPE, group_name: "B", is_active: false, sort_order: 1, items: [{ ...row, id: "b-row", price: 125 }] },
    ];
    const administrativeRows = flattenBaseModelPricingRows(grouped);
    const selectableRows = flattenBaseModelPricingRows(grouped, { activeGroupsOnly: true }).filter((item) => item.is_active !== false);
    assert.deepEqual(administrativeRows.map((item) => item.id), ["a-row", "b-row"]);
    assert.deepEqual(selectableRows.map((item) => item.id), ["a-row"]);
    assert.equal(administrativeRows.find((item) => item.id === "b-row")?.price, 125);
    assert.equal(administrativeRows.length, 2);
});
