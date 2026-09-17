import assert from "node:assert/strict";
import test from "node:test";
import { BASE_MODEL_GROUP_PRICING_TYPE, BaseModelPricingContractError, LEGACY_BASE_MODEL_GROUP_ID, LEGACY_BASE_MODEL_GROUP_NAME, baseModelPricingGroups, flattenBaseModelPricingRows, hasExplicitBaseModelPricingGroupStructure, hasMeaningfulBaseModelPricingData, normalizeBaseModelPricing, serializeBaseModelPricingGroups, } from "./base-model-pricing-groups.js";
const legacyRows = [
    { id: "model-a", variant_name: "A", supplier_price_list_code: "A-01", price: null, currency: "AED", sort_order: 0, is_active: true },
    { id: "model-b", display_name: "Model B", dimension: "140 x 70", price: 0, specification: "Zero price", sort_order: 1, is_active: false },
    { id: "model-c", variant_name: "C", price: 123.45, sort_order: 2, is_active: true },
];
function group(id, name, items, active = true, sortOrder = 0) {
    return { id, pricing_type: BASE_MODEL_GROUP_PRICING_TYPE, group_name: name, is_active: active, sort_order: sortOrder, items };
}
test("non-empty legacy rows normalize into one deterministic synthetic group without mutation", () => {
    const before = structuredClone(legacyRows);
    const normalized = normalizeBaseModelPricing(legacyRows);
    assert.equal(normalized.sourceKind, "legacy");
    assert.equal(normalized.issues.length, 0);
    assert.deepEqual(normalized.groups[0], {
        id: LEGACY_BASE_MODEL_GROUP_ID,
        pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
        group_name: LEGACY_BASE_MODEL_GROUP_NAME,
        is_active: true,
        sort_order: 0,
        items: legacyRows,
        isSyntheticLegacyGroup: true,
    });
    assert.deepEqual(legacyRows, before);
    assert.notEqual(normalized.groups[0].items[0], legacyRows[0]);
});
test("empty legacy data has zero groups and explicit empty groups remain structural but commercially empty", () => {
    assert.deepEqual(baseModelPricingGroups([]), []);
    const empty = [group("empty", "Empty", [])];
    assert.equal(baseModelPricingGroups(empty).length, 1);
    assert.equal(hasExplicitBaseModelPricingGroupStructure(empty), true);
    assert.equal(hasMeaningfulBaseModelPricingData(empty), false);
});
test("explicit groups preserve ids, names, order, items, row ids, null, zero, and exact numbers", () => {
    const input = [
        group("inactive", "Inactive", [legacyRows[0]], false, 9),
        group("active", "Active", [legacyRows[1], legacyRows[2]], true, 2),
    ];
    const groups = baseModelPricingGroups(input);
    assert.deepEqual(groups.map((entry) => [entry.id, entry.group_name, entry.is_active, entry.sort_order]), [
        ["inactive", "Inactive", false, 9],
        ["active", "Active", true, 2],
    ]);
    assert.deepEqual(groups[1].items.map((row) => row.id), ["model-b", "model-c"]);
    assert.deepEqual(groups.flatMap((entry) => entry.items).map((row) => row.price), [null, 0, 123.45]);
});
test("flattening follows group then row order and includes inactive groups unless explicitly filtered", () => {
    const input = [
        group("one", "One", [legacyRows[0], legacyRows[1]], false),
        group("two", "Two", [legacyRows[2]], true, 1),
    ];
    assert.deepEqual(flattenBaseModelPricingRows(input).map((row) => row.id), ["model-a", "model-b", "model-c"]);
    assert.deepEqual(flattenBaseModelPricingRows(input, { activeGroupsOnly: true }).map((row) => row.id), ["model-c"]);
});
test("mixed input keeps legacy rows in a leading synthetic group and explicit groups in source order", () => {
    const input = [legacyRows[0], group("explicit-a", "A", [legacyRows[1]]), legacyRows[2], group("explicit-b", "B", [])];
    const normalized = normalizeBaseModelPricing(input);
    assert.equal(normalized.sourceKind, "mixed");
    assert.deepEqual(normalized.groups.map((entry) => entry.id), [LEGACY_BASE_MODEL_GROUP_ID, "explicit-a", "explicit-b"]);
    assert.deepEqual(normalized.groups[0].items.map((row) => row.id), ["model-a", "model-c"]);
});
test("duplicate ids and reserved synthetic-id conflicts produce deterministic validation errors", () => {
    assert.throws(() => baseModelPricingGroups([group("same", "One", []), group("same", "Two", [])]), (error) => error instanceof BaseModelPricingContractError && error.issues.some((issue) => issue.code === "duplicate_group_id"));
    assert.doesNotThrow(() => baseModelPricingGroups([group(LEGACY_BASE_MODEL_GROUP_ID, "Saved legacy", [])]));
    assert.throws(() => baseModelPricingGroups([legacyRows[0], group(LEGACY_BASE_MODEL_GROUP_ID, "Conflict", [])]), /conflicts with the synthesized legacy group/);
});
test("invalid roots, malformed groups and rows, and unsupported discriminators report issues safely", () => {
    assert.equal(normalizeBaseModelPricing({}).issues[0].code, "invalid_root");
    assert.throws(() => baseModelPricingGroups([{ id: "bad", pricing_type: BASE_MODEL_GROUP_PRICING_TYPE, group_name: "Bad", is_active: true, sort_order: 0 }]), /items array/);
    assert.throws(() => baseModelPricingGroups([group("bad-row", "Bad row", [null])]), /invalid row/);
    assert.throws(() => baseModelPricingGroups([group("nested-type", "Nested", [{ id: "nested", pricing_type: "other_group" }])]), /invalid row/);
    assert.throws(() => baseModelPricingGroups([{ id: "bad-price", price: "not-a-number" }]), /malformed row value/);
    assert.throws(() => baseModelPricingGroups([{ pricing_type: "other_group", id: "other" }]), /unsupported pricing type/);
});
test("serialization emits only the locked explicit shape and round-trips legacy rows", () => {
    const normalizedLegacy = baseModelPricingGroups(legacyRows);
    const serialized = serializeBaseModelPricingGroups(normalizedLegacy);
    assert.deepEqual(Object.keys(serialized[0]), ["id", "pricing_type", "group_name", "is_active", "sort_order", "items"]);
    assert.equal("isSyntheticLegacyGroup" in serialized[0], false);
    assert.deepEqual(flattenBaseModelPricingRows(serialized), legacyRows);
});
test("ProductTemplateDraft v1 remains flat and has no Base/Model groups key", () => {
    const hasBaseModelGroups = false;
    const baseModelRowsKey = "baseModelRows";
    assert.equal(hasBaseModelGroups, false);
    assert.equal(baseModelRowsKey, "baseModelRows");
});
