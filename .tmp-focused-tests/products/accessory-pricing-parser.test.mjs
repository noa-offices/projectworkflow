import assert from "node:assert/strict";
import test from "node:test";
import { AccessoryPricingContractError, parseAccessoryPricingJson } from "./accessory-pricing-parser.js";
import { BASE_MODEL_GROUP_PRICING_TYPE } from "./base-model-pricing-groups.js";
import { LEGACY_WORKSTATION_GROUP_ID } from "./workstation-pricing-groups.js";
const variants = [{ id: "desks", pricing_type: BASE_MODEL_GROUP_PRICING_TYPE, group_name: "Desks", is_active: true, sort_order: 0, items: [{ id: "1AF003", variant_name: "Desk", price: 100 }] }];
const metadata = {
    role: "conditional_option",
    selection: "exactly_one",
    applicability: [{ base_model_group_id: "desks", base_model_row_id: "1AF003", required: true, visible: true, allowed_item_ids: ["top"] }],
};
const legacyGroup = { id: "legacy", group_name: "Accessories", group_is_required: true, is_active: true, sort_order: 0, items: [{ id: "legacy-item", item_name: "Legacy", supplier_price_list_code: "LEG", price: null, currency: "EUR", specification: "Legacy spec", is_active: true, sort_order: 0 }] };
const conditionalGroup = { ...legacyGroup, id: "top-group", group_name: "Top Access", group_is_required: false, items: [{ ...legacyGroup.items[0], id: "top", price: 0 }], conditional_configuration: metadata };
const categories = [{ id: "everyis1", group_name: "EVERYis1", price_categories: ["Cat A"], items: [{ id: "ev111", variant_name: "EV111", prices: { "Cat A": 100 } }] }];
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
    assert.throws(() => parseAccessoryPricingJson(JSON.stringify([conditionalGroup]), removedRow), (error) => error instanceof AccessoryPricingContractError && error.issues.some((issue) => issue.code === "unknown_base_model_reference"));
});
test("Category / Matrix target references round-trip and reject missing stable IDs", () => {
    const target = { kind: "price_matrix", group_id: "everyis1", row_id: "ev111" };
    const matrixGroup = { ...conditionalGroup, conditional_configuration: { ...metadata, applicability: [{ target, required: false, visible: true }] } };
    assert.deepEqual(parseAccessoryPricingJson(JSON.stringify([matrixGroup]), variants, categories)[0].conditional_configuration?.applicability[0].target, target);
    assert.throws(() => parseAccessoryPricingJson(JSON.stringify([matrixGroup]), variants, [{ ...categories[0], items: [] }]), (error) => error instanceof AccessoryPricingContractError && error.issues.some((issue) => issue.code === "unknown_price_matrix_reference"));
});
test("null and zero prices remain distinct", () => {
    const parsed = parseAccessoryPricingJson(JSON.stringify([legacyGroup, conditionalGroup]), variants);
    assert.equal(parsed[0].items?.[0].price, null);
    assert.equal(parsed[1].items?.[0].price, 0);
});
test("optional accessory dimensions round-trip while legacy rows remain unchanged", () => {
    const dimensioned = { ...legacyGroup, items: [{ ...legacyGroup.items[0], dimension: " L.90 x p.37 " }] };
    const parsed = parseAccessoryPricingJson(JSON.stringify([dimensioned]), variants);
    assert.equal(parsed[0].items?.[0].dimension, "L.90 x p.37");
    assert.equal("dimension" in (parseAccessoryPricingJson(JSON.stringify([legacyGroup]), variants)[0].items?.[0] ?? {}), false);
});
test("accessory requirements round-trip separately from specification", () => {
    const requirements = { ...legacyGroup, items: [{ ...legacyGroup.items[0], specification: "Included fixing kit.", importantRequirements: [" Finishing top required ", "Finishing top required", "Wall fixing required"] }] };
    const parsed = parseAccessoryPricingJson(JSON.stringify([requirements]), variants);
    assert.equal(parsed[0].items?.[0].specification, "Included fixing kit.");
    assert.deepEqual(parsed[0].items?.[0].importantRequirements, ["Finishing top required", "Wall fixing required"]);
});
test("category-priced accessories retain group categories and authoritative price maps", () => {
    const cushions = { ...legacyGroup, price_categories: [{ id: "B", label: "Cat B" }, { id: "SUPREME", label: "Supreme" }], items: [{ ...legacyGroup.items[0], prices: { B: 93, SUPREME: 162 }, unavailable_price_categories: ["G"] }] };
    const parsed = parseAccessoryPricingJson(JSON.stringify([cushions]), variants);
    assert.deepEqual(parsed[0].price_categories, cushions.price_categories);
    assert.deepEqual(parsed[0].items?.[0].prices, { B: 93, SUPREME: 162 });
});
// --- Modular + Workstation applicability targets (Apply/save validation gap fix) ---
const matrixModularGroups = [{
        id: "mod-matrix-group", group_name: "Sofa Modules", pricing_type: "modular_group",
        items: [{ id: "matrix-row-1", pricing_type: "modular_item", variant_name: "Corner", prices: { "Cat A": 990 }, is_active: true }],
    }];
const directModularGroups = [{
        id: "mod-oxi-p-bench", group_name: "OXI_P Bench", pricing_type: "modular_group", modular_pricing_mode: "direct",
        modular_composition: { min_starters: 1, max_starters: 1 },
        items: [
            { id: "bench-starter-120", pricing_type: "modular_item", variant_name: "Starter 120", display_name: "Starter Bench 120", price: 425, is_active: true, modular_role: "starter" },
            { id: "bench-intermediate-120", pricing_type: "modular_item", variant_name: "Intermediate 120", display_name: "Intermediate Bench 120", price: 421, is_active: true, modular_role: "intermediate" },
        ],
    }];
// Flat legacy-style workstation rows (no group wrapper) synthesize into one group under the
// fixed sentinel id, matching the TARGET GROUP_ID CONVENTION the extraction prompt teaches.
const workstationGroups = [{ id: "oxi-q-ws-dx", variant_name: "OXI Q DX", price: 1200, is_active: true }];
function modularCompanionGroup(target, extra = {}) {
    return { ...legacyGroup, id: "art058", group_name: "ART.058", items: [{ ...legacyGroup.items[0], id: "art-058-item", item_name: "ART.058", price: 69 }],
        conditional_configuration: { role: "companion", selection: "at_least_one", applicability: [{ target, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true, ...extra }] } };
}
test("Matrix Modular target validates and an unknown Matrix Modular row is rejected", () => {
    const target = { kind: "modular", group_id: "mod-matrix-group", row_id: "matrix-row-1" };
    const group = { ...conditionalGroup, conditional_configuration: { ...metadata, applicability: [{ target, required: false, visible: true }] } };
    assert.deepEqual(parseAccessoryPricingJson(JSON.stringify([group]), variants, matrixModularGroups)[0].conditional_configuration?.applicability[0].target, target);
    const unknownTarget = { kind: "modular", group_id: "mod-matrix-group", row_id: "matrix-row-missing" };
    const badGroup = { ...conditionalGroup, conditional_configuration: { ...metadata, applicability: [{ target: unknownTarget, required: false, visible: true }] } };
    assert.throws(() => parseAccessoryPricingJson(JSON.stringify([badGroup]), variants, matrixModularGroups), (error) => error instanceof AccessoryPricingContractError && error.issues.some((issue) => issue.code === "unknown_modular_reference" && issue.message.startsWith("Modular reference")));
});
test("Direct Modular starter and intermediate targets both validate", () => {
    const starterTarget = { kind: "modular", group_id: "mod-oxi-p-bench", row_id: "bench-starter-120" };
    const intermediateTarget = { kind: "modular", group_id: "mod-oxi-p-bench", row_id: "bench-intermediate-120" };
    assert.doesNotThrow(() => parseAccessoryPricingJson(JSON.stringify([modularCompanionGroup(starterTarget)]), variants, directModularGroups));
    assert.doesNotThrow(() => parseAccessoryPricingJson(JSON.stringify([modularCompanionGroup(intermediateTarget)]), variants, directModularGroups));
});
test("an unknown Direct Modular row is rejected", () => {
    const target = { kind: "modular", group_id: "mod-oxi-p-bench", row_id: "bench-starter-999" };
    assert.throws(() => parseAccessoryPricingJson(JSON.stringify([modularCompanionGroup(target)]), variants, directModularGroups), (error) => error instanceof AccessoryPricingContractError && error.issues.some((issue) => issue.code === "unknown_modular_reference"));
});
test("the correct row in the wrong Modular group is rejected", () => {
    const target = { kind: "modular", group_id: "mod-wrong-group", row_id: "bench-starter-120" };
    assert.throws(() => parseAccessoryPricingJson(JSON.stringify([modularCompanionGroup(target)]), variants, directModularGroups), (error) => error instanceof AccessoryPricingContractError && error.issues.some((issue) => issue.code === "unknown_modular_reference"));
});
test("Workstation target validates and an unknown Workstation row is rejected", () => {
    const target = { kind: "workstation", group_id: LEGACY_WORKSTATION_GROUP_ID, row_id: "oxi-q-ws-dx" };
    const group = { ...conditionalGroup, conditional_configuration: { ...metadata, applicability: [{ target, required: false, visible: true }] } };
    assert.deepEqual(parseAccessoryPricingJson(JSON.stringify([group]), variants, [], workstationGroups)[0].conditional_configuration?.applicability[0].target, target);
    const unknownTarget = { kind: "workstation", group_id: LEGACY_WORKSTATION_GROUP_ID, row_id: "oxi-q-ws-missing" };
    const badGroup = { ...conditionalGroup, conditional_configuration: { ...metadata, applicability: [{ target: unknownTarget, required: false, visible: true }] } };
    assert.throws(() => parseAccessoryPricingJson(JSON.stringify([badGroup]), variants, [], workstationGroups), (error) => error instanceof AccessoryPricingContractError && error.issues.some((issue) => issue.code === "unknown_workstation_reference" && issue.message.startsWith("Workstation reference")));
});
test("OXI ART.058 regression: fixed_quantity and scale_with_target_quantity survive Apply/save validation for a Direct Modular target", () => {
    const starterTarget = { kind: "modular", group_id: "mod-oxi-p-bench", row_id: "bench-starter-120" };
    const parsed = parseAccessoryPricingJson(JSON.stringify([modularCompanionGroup(starterTarget)]), variants, directModularGroups);
    const rule = parsed[0].conditional_configuration?.applicability[0];
    assert.equal(rule?.fixed_quantity, 2);
    assert.equal(rule?.scale_with_target_quantity, true);
    assert.equal(parsed[0].items?.[0].price, 69, "Expected the real ART.058 unit price to be preserved, never a multiplied EUR 138 price");
});
