import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft } from "./product-template-draft.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { rebuildApplicableModelRules, describeOptionItemRelationships, optionGroupRelationshipType, optionItemRelationshipType, optionItemRolePatch, orderSmartOptionRoutes, SMART_OPTION_RELATIONSHIP_LABELS } from "./smart-product-option-relationships.js";
import type { SmartReviewAccessoryConfiguration } from "./smart-product-review-routing.js";
import { createSmartSetupReviewRouting, draftForSmartSetupReviewApply, validateSmartSetupReviewRouting } from "./smart-product-review-routing.js";

const item = (id: string, extra: { role?: "normal" | "companion" | "structural_support" } = {}) => ({ id, label: id, displayName: `Name ${id}`, dimensions: { width: 120, depth: 70, height: 73.6, diameter: null, unit: "cm", rawText: "L.120 x p.70 x H.73,6" }, currency: "EUR" as const, price: 399, specification: "spec", supplierCodes: [`SKU-${id}`], referenceCodes: [], ...extra });
const selection = { mode: "optional" as const, minSelections: 0, maxSelections: null, defaultItemIds: [] };
const build = (): ProductTemplateDraft => ({
  version: 1, template: { templateName: "T", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: "EUR",
  pricing: { workstationRows: [], baseModelRows: [], modularGroups: [], priceMatrices: [] },
  optionGroups: [
    { id: "optional", label: "COMBY Complements", selection, items: [item("cable-tray")] },
    { id: "top", label: "COMBY Finishing Top", selection, items: [item("top-b")] },
    { id: "structural", label: "Structural Base & Support Cabinets", selection, items: [item("support-a", { role: "structural_support" })] },
  ],
  materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
});
const withCompanionRoute = (draft: ProductTemplateDraft) => {
  const plan = createSmartSetupReviewRouting(draft);
  plan.routes.find((route) => route.sourceId === "top")!.accessory = { role: "companion", selection: "required_at_least_one", rules: [{ target: { kind: "option_item", group_id: "structural", row_id: "support-a" }, required: true, fixedQuantity: 1 }] };
  return plan;
};

test("groups are classified and ordered Structural, Required Companion, Optional without changing routes", () => {
  const draft = build();
  const plan = withCompanionRoute(draft);
  const types = plan.routes.map((route) => optionGroupRelationshipType(draft.optionGroups.find((group) => group.id === route.sourceId), route));
  assert.deepEqual(plan.routes.map((route) => route.sourceId), ["optional", "top", "structural"], "underlying route order is untouched");
  assert.deepEqual(types, ["optional_accessory", "required_companion", "structural_support"]);
  assert.deepEqual(orderSmartOptionRoutes(plan.routes, draft).map((route) => route.sourceId), ["structural", "top", "optional"]);
  assert.ok(plan.routes.every((route) => route.destination !== "base_model"), "structural support is never relabelled as Base/Model");
});

test("non-option routes keep their slots when option routes are re-sequenced", () => {
  const draft = build();
  draft.pricing.priceMatrices = [{ id: "m", label: "m", columns: [{ id: "p", label: "P" }], rows: [{ id: "r", label: "r", displayName: null, dimensions: null, currency: "EUR", specification: null, supplierCodes: [], referenceCodes: [], prices: { p: 1 } }] }];
  const routes = createSmartSetupReviewRouting(draft).routes;
  const ordered = orderSmartOptionRoutes(routes, draft);
  assert.equal(ordered.findIndex((route) => route.sourceKind === "matrix"), routes.findIndex((route) => route.sourceKind === "matrix"));
});

test("item badges: explicit role wins, companion groups label role-less items, role-less legacy items stay optional", () => {
  assert.equal(optionItemRelationshipType({ role: "structural_support" }, "optional_accessory"), "structural_support");
  assert.equal(optionItemRelationshipType({}, "required_companion"), "required_companion");
  assert.equal(optionItemRelationshipType({}, "optional_accessory"), "optional_accessory");
  assert.equal(SMART_OPTION_RELATIONSHIP_LABELS.optional_accessory, "Optional Accessory");
  assert.equal(optionGroupRelationshipType({ items: [{}] }), "optional_accessory", "old role-less group");
});

test("role edit changes only role; price, code, dimensions, specification and id are untouched", () => {
  const original = item("x");
  const edited = { ...original, ...optionItemRolePatch("structural_support") };
  assert.deepEqual({ ...edited, role: undefined }, { ...original, role: undefined });
  assert.equal(edited.role, "structural_support");
  assert.equal({ ...edited, ...optionItemRolePatch("normal") }.role, undefined);
});

test("option_item relationship resolves labels for display and flags unresolved targets", () => {
  const draft = build();
  const rows = describeOptionItemRelationships(draft, [{ target: { kind: "option_item", group_id: "structural", row_id: "support-a" }, required: true, fixedQuantity: 1, scaleWithTargetQuantity: true }, { target: { kind: "option_item", group_id: "structural", row_id: "gone" }, required: false }, { baseModelGroupId: "g", baseModelRowId: "r", required: true }]);
  assert.equal(rows.length, 2, "only option_item rules are described");
  assert.deepEqual(rows[0], { triggeredBy: "Structural Base & Support Cabinets › Name support-a", resolved: true, required: true, fixedQuantity: 1, scaled: true, targetKind: "Option item" });
  assert.equal(rows[1].resolved, false);
});

test("Apply output preserves the edited role and the option_item relationship; relationship still validates", () => {
  const draft = build();
  draft.optionGroups[0].items[0] = { ...draft.optionGroups[0].items[0], ...optionItemRolePatch("companion") } as never;
  const plan = withCompanionRoute(draft);
  assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, true);
  const groups = mapDraftOptionGroupsToAccessories(draftForSmartSetupReviewApply(draft, plan), plan).groups;
  const optional = groups.find((group) => group.id === "optional")!;
  assert.equal(optional.items[0].role, "companion");
  assert.equal(optional.items[0].price, 399);
  assert.equal(optional.items[0].supplier_price_list_code, "SKU-cable-tray");
  assert.equal(groups.find((group) => group.id === "structural")!.items[0].role, "structural_support");
  assert.deepEqual(groups.find((group) => group.id === "top")!.conditional_configuration?.applicability[0].target, { kind: "option_item", group_id: "structural", row_id: "support-a" });
});

const optionRule = { target: { kind: "option_item" as const, group_id: "structural", row_id: "support-a" }, required: true, visible: true, fixedQuantity: 1, scaleWithTargetQuantity: true };
const baseChoice = { key: "base_model\u0000g\u0000bm", target: { kind: "base_model" as const, group_id: "g", row_id: "bm" } };
const modularChoice = { key: "modular\u0000mod\u0000mr", target: { kind: "modular" as const, group_id: "mod", row_id: "mr" } };
const accessoryWith = (rules: SmartReviewAccessoryConfiguration["rules"], selection: SmartReviewAccessoryConfiguration["selection"] = "optional_multiple"): SmartReviewAccessoryConfiguration => ({ role: "companion", selection, rules });

test("Applicable Models commit preserves option_item rules byte-for-byte for Base/Model, Modular and empty selections", () => {
  const snapshot = structuredClone(optionRule);
  const existing = accessoryWith([optionRule, { baseModelGroupId: "g", baseModelRowId: "bm", required: false }]);
  const base = rebuildApplicableModelRules(existing, [baseChoice, modularChoice], new Set([baseChoice.key]));
  assert.deepEqual(base, [optionRule, { baseModelGroupId: "g", baseModelRowId: "bm", required: false }]);
  const modular = rebuildApplicableModelRules(existing, [baseChoice, modularChoice], new Set([modularChoice.key]));
  assert.deepEqual(modular, [optionRule, { target: modularChoice.target, required: false }]);
  const none = rebuildApplicableModelRules(existing, [baseChoice, modularChoice], new Set());
  assert.deepEqual(none, [optionRule]);
  assert.deepEqual(optionRule, snapshot, "input rule is not mutated");
  assert.ok(none[0] === optionRule, "preserved rule is the same object, never rebuilt or normalized");
});

test("Applicable Models commit still adds, keeps and removes pricing-row rules with the same defaults", () => {
  const kept = { baseModelGroupId: "g", baseModelRowId: "bm", required: true, allowedItemIds: ["x"] };
  const rules = rebuildApplicableModelRules(accessoryWith([kept], "required_exactly_one"), [baseChoice, modularChoice], new Set([baseChoice.key, modularChoice.key]));
  assert.deepEqual(rules, [kept, { target: modularChoice.target, required: true, fixedQuantity: 1 }]);
  assert.deepEqual(rebuildApplicableModelRules(accessoryWith([kept]), [baseChoice], new Set()), []);
});

test("item role mapping keeps the exact runtime shape for structural_support, companion, normal and role-less items", () => {
  const draft = build();
  draft.optionGroups[0].items = [item("a", { role: "structural_support" }), item("b", { role: "companion" }), item("c", { role: "normal" }), item("d")];
  const mapped = mapDraftOptionGroupsToAccessories(draft).groups[0].items;
  assert.deepEqual(mapped.map((entry) => entry.role), ["structural_support", "companion", undefined, undefined]);
  assert.ok(!("role" in mapped[3]), "role-less old item gains no role key");
  assert.equal(mapped[3].price, 399);
});
