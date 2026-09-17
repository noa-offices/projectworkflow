import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductTemplateDraft, isDirectModularGroup, draftModularRows, draftModularColumns } from "./product-template-draft.js";
import { analyzeDraftModularCompatibility } from "./draft-modular-compatibility.js";
import { mapDraftModularPricing } from "./product-template-draft-modular-adapter.js";
import { activeModularSelectionFamilyGroupId, evaluateModularComposition, validateModularCompositionGroups, validateModularSelectionFamilyConflicts } from "./modular-composition.js";
import { isDirectModularPricingGroup, modularCompositionRule, modularRowRole, modularSelectionFamily } from "./modular-pricing.js";
import { evaluateAccessoryConfigurationForModel, accessoryApplicabilityTargetKey } from "./accessory-conditional-configuration.js";
import { categoryPricingValue } from "./category-pricing-value.js";

/** Runtime modular items are a union of matrix-priced and direct-priced shapes. */
function directPrice(row: unknown) {
  return Number((row as { price?: number | null }).price);
}

function baseDraft() {
  return {
    version: 1,
    template: { templateName: "OXI_P" },
    defaultCurrency: "EUR",
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] as Record<string, unknown>[] },
    optionGroups: [] as Record<string, unknown>[],
    materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 0.9, sources: [],
  };
}

/** OXI_P: starter bench A (111 065) + intermediate bench B (111 069), each direct-priced. */
function oxiDirectGroup(composition: unknown = { minStarters: 1, maxStarters: 1 }) {
  return {
    id: "oxi-p-bench",
    label: "OXI_P Bench",
    defaultDimensions: null,
    defaultSpecification: null,
    pricingMode: "direct",
    directRows: [
      { id: "oxi-p-starter-140", label: "Starter bench 140", price: 425, currency: "EUR", supplierCodes: ["111 065"], role: "starter", importantRequirements: ["Move the panel to terminal position to finish the composition."] },
      { id: "oxi-p-intermediate-140", label: "Intermediate bench 140", price: 421, currency: "EUR", supplierCodes: ["111 069"], role: "intermediate" },
    ],
    ...(composition === undefined ? {} : { composition }),
  };
}

/** A minimal generic direct-priced group, used only to test cross-group selectionFamily exclusivity. Never named after any real manufacturer family. */
function directGroup(id: string, selectionFamily?: string) {
  return {
    id,
    label: `Configuration ${id}`,
    defaultDimensions: null,
    defaultSpecification: null,
    pricingMode: "direct",
    ...(selectionFamily ? { selectionFamily } : {}),
    directRows: [
      { id: `${id}-starter`, label: `${id} starter`, price: 100, currency: "EUR", supplierCodes: [`${id}-CODE`], role: "starter" },
    ],
  };
}

function matrixGroup(id = "sofa-modules") {
  return {
    id, label: "Sofa Modules", defaultDimensions: null, defaultSpecification: null,
    matrix: { id: `${id}-matrix`, label: "Upholstery", columns: [{ id: "cat-a", label: "Cat A" }], rows: [{ id: "corner", label: "Corner", prices: { "cat-a": 990 } }] },
  };
}

/**
 * A generic Matrix Modular group with starter/intermediate rows that also carry finish-category
 * prices (architecture only — never named after a real manufacturer family). Mirrors the Terra
 * Office shape: one composition group, two finish-category columns, starter + intermediate roles.
 */
function matrixGroupWithRoles(id = "composed-matrix", composition: unknown = { minStarters: 1, maxStarters: 1 }) {
  return {
    id,
    label: "Composed Matrix Group",
    defaultDimensions: null,
    defaultSpecification: null,
    matrix: {
      id: `${id}-matrix`,
      label: "Finish",
      columns: [{ id: "standard", label: "Standard" }, { id: "designs", label: "Designs" }],
      rows: [
        { id: `${id}-starter`, label: "Starter Row", role: "starter", prices: { standard: 1310, designs: 1874 } },
        { id: `${id}-intermediate`, label: "Extension Row", role: "intermediate", prices: { standard: 1454, designs: 2148 } },
      ],
    },
    ...(composition === undefined ? {} : { composition }),
  };
}

test("1-2: a direct-priced modular group parses and preserves the scalar row price, codes and requirements", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(oxiDirectGroup());
  const result = normalizeProductTemplateDraft(draft);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const group = result.draft!.pricing.modularGroups[0];
  assert.equal(isDirectModularGroup(group), true);
  assert.equal(group.matrix, undefined, "Expected no fake one-column matrix");
  assert.deepEqual(draftModularColumns(group), []);
  assert.equal(group.directRows?.[0].price, 425);
  assert.equal(group.directRows?.[1].price, 421);
  assert.deepEqual(group.directRows?.[0].supplierCodes, ["111 065"]);
  assert.equal(group.directRows?.[0].currency, "EUR");
  assert.deepEqual(group.directRows?.[0].importantRequirements, ["Move the panel to terminal position to finish the composition."]);
  assert.equal(draftModularRows(group).length, 2);
});

test("3: matrix modular groups remain unchanged and keep their category cells", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroup());
  const result = normalizeProductTemplateDraft(draft);
  assert.equal(result.valid, true);
  const group = result.draft!.pricing.modularGroups[0];
  assert.equal(isDirectModularGroup(group), false);
  assert.equal(group.directRows, undefined);
  assert.equal(group.matrix!.rows[0].prices["cat-a"], 990);
  assert.deepEqual(draftModularColumns(group).map((column) => column.id), ["cat-a"]);
});

test("4-6: starter/intermediate roles and starter cardinality persist through normalization", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(oxiDirectGroup({ minStarters: 1, maxStarters: 1 }));
  const group = normalizeProductTemplateDraft(draft).draft!.pricing.modularGroups[0];
  assert.equal(group.directRows?.[0].role, "starter");
  assert.equal(group.directRows?.[1].role, "intermediate");
  assert.deepEqual(group.composition, { minStarters: 1, maxStarters: 1 });
});

test("normalization rejects contradictory direct+matrix groups, unknown roles, and starterless compositions", () => {
  const contradictory = baseDraft();
  contradictory.pricing.modularGroups.push({ ...oxiDirectGroup(), matrix: matrixGroup().matrix });
  assert.equal(normalizeProductTemplateDraft(contradictory).valid, false);

  const badRole = baseDraft();
  badRole.pricing.modularGroups.push({ ...oxiDirectGroup(), directRows: [{ id: "row", label: "Row", price: 10, role: "middle" }] });
  assert.equal(normalizeProductTemplateDraft(badRole).valid, false);

  const noStarterRow = baseDraft();
  noStarterRow.pricing.modularGroups.push({ ...oxiDirectGroup(), directRows: [{ id: "row", label: "Row", price: 10, role: "intermediate" }] });
  assert.equal(normalizeProductTemplateDraft(noStarterRow).valid, false);
});

test("direct-priced groups are exempt from the shared category-column contract and still map to runtime", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroup(), oxiDirectGroup());
  const normalized = normalizeProductTemplateDraft(draft);
  assert.equal(normalized.valid, true);
  const analysis = analyzeDraftModularCompatibility(normalized.draft!);
  assert.equal(analysis.compatible, true, "Expected a direct group beside a matrix group to stay compatible");
  assert.equal(analysis.groups.length, 1);
  assert.equal(analysis.directGroups.length, 1);

  const mapped = mapDraftModularPricing(normalized.draft!);
  assert.equal(mapped.compatible, true);
  const runtimeDirect = mapped.groups.find((group) => group.id === "oxi-p-bench")!;
  assert.equal(isDirectModularPricingGroup(runtimeDirect), true);
  assert.deepEqual(runtimeDirect.price_categories, []);
  assert.deepEqual(modularCompositionRule(runtimeDirect), { minStarters: 1, maxStarters: 1 });
  assert.equal(directPrice(runtimeDirect.items[0]), 425, "Expected the authoritative unit price, never a multiplied total");
  assert.equal(modularRowRole(runtimeDirect.items[0]), "starter");
  assert.equal(modularRowRole(runtimeDirect.items[1]), "intermediate");
  const runtimeMatrix = mapped.groups.find((group) => group.id === "sofa-modules")!;
  assert.equal(isDirectModularPricingGroup(runtimeMatrix), false);
  assert.deepEqual(runtimeMatrix.price_categories, ["Cat A"]);
});

test("7-8: composition blocks intermediates without a starter and more starters than allowed", () => {
  const rule = { minStarters: 1, maxStarters: 1 };
  const starter = { qty: 1, roleValue: "starter" as const, rowId: "a" };
  const intermediate = { qty: 2, roleValue: "intermediate" as const, rowId: "b" };

  assert.equal(evaluateModularComposition(rule, [starter, intermediate]), null);
  assert.equal(evaluateModularComposition(rule, [{ ...starter, qty: 0 }, intermediate])?.code, "starter_missing_for_intermediate");
  assert.equal(evaluateModularComposition(rule, [{ ...starter, qty: 2 }])?.code, "too_many_starters");
  assert.equal(evaluateModularComposition(rule, []), null, "An empty composition is handled by the existing required-selection rule");
  assert.equal(evaluateModularComposition(null, [intermediate])?.code, "starter_missing_for_intermediate");
  assert.equal(evaluateModularComposition(null, [{ qty: 3, roleValue: null, rowId: "plain" }]), null, "Role-less modular rows stay unconstrained");
});

test("9-10: row quantities and direct totals resolve from the authoritative unit price", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(oxiDirectGroup());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups[0];
  const quantities: Record<string, number> = { "oxi-p-starter-140": 1, "oxi-p-intermediate-140": 2 };
  const lines = group.items.map((row) => ({ qty: quantities[row.id] ?? 0, total: (quantities[row.id] ?? 0) * directPrice(row) }));
  assert.deepEqual(lines, [{ qty: 1, total: 425 }, { qty: 2, total: 842 }]);
  assert.equal(validateModularCompositionGroups([group], (_groupId, rowId) => quantities[rowId] ?? 0), null);
  assert.equal(validateModularCompositionGroups([group], (_groupId, rowId) => rowId === "oxi-p-intermediate-140" ? 2 : 0)?.code, "starter_missing_for_intermediate");
});

const companionGroups = (scale: boolean) => [{
  id: "art-058",
  group_name: "Top access",
  items: [{ id: "art-058-item", item_name: "ART.058", price: 69, is_active: true }],
  conditional_configuration: {
    role: "companion" as const,
    selection: "at_least_one" as const,
    applicability: [
      { target: { kind: "modular" as const, group_id: "oxi-p-bench", row_id: "oxi-p-starter-140" }, required: true, visible: true, fixed_quantity: 2, ...(scale ? { scale_with_target_quantity: true } : {}) },
      { target: { kind: "modular" as const, group_id: "oxi-p-bench", row_id: "oxi-p-intermediate-140" }, required: true, visible: true, fixed_quantity: 2, ...(scale ? { scale_with_target_quantity: true } : {}) },
    ],
  },
}];

function evaluateOxiCompanion(selection: Array<{ rowId: string; qty: number }>, companionQty: number, scale = true) {
  const targets = selection.map((item) => ({ kind: "modular" as const, group_id: "oxi-p-bench", row_id: item.rowId }));
  return evaluateAccessoryConfigurationForModel({
    accessoryGroups: companionGroups(scale),
    baseModelGroupId: null,
    baseModelRowId: null,
    selectedModelTargets: targets,
    selectedModelTargetQuantities: Object.fromEntries(selection.map((item) => [accessoryApplicabilityTargetKey({ kind: "modular", group_id: "oxi-p-bench", row_id: item.rowId }), item.qty])),
    selectedQuantitiesByGroupId: { "art-058": { "art-058-item": companionQty } },
  });
}

test("11: starter qty 1 requires 2 x ART.058", () => {
  const evaluation = evaluateOxiCompanion([{ rowId: "oxi-p-starter-140", qty: 1 }], 2);
  assert.equal(evaluation.groups[0].fixedQuantity, 2);
  assert.equal(evaluation.valid, true);
});

test("12: starter 1 + intermediate 1 requires 4 x ART.058", () => {
  const evaluation = evaluateOxiCompanion([{ rowId: "oxi-p-starter-140", qty: 1 }, { rowId: "oxi-p-intermediate-140", qty: 1 }], 4);
  assert.equal(evaluation.groups[0].fixedQuantity, 4);
  assert.equal(evaluation.valid, true);
  assert.equal(evaluateOxiCompanion([{ rowId: "oxi-p-starter-140", qty: 1 }, { rowId: "oxi-p-intermediate-140", qty: 1 }], 2).valid, false);
});

test("13: starter 1 + intermediate 2 requires 6 x ART.058", () => {
  const evaluation = evaluateOxiCompanion([{ rowId: "oxi-p-starter-140", qty: 1 }, { rowId: "oxi-p-intermediate-140", qty: 2 }], 6);
  assert.equal(evaluation.groups[0].fixedQuantity, 6);
  assert.equal(evaluation.valid, true);
  const wrongQuantity = evaluateOxiCompanion([{ rowId: "oxi-p-starter-140", qty: 1 }, { rowId: "oxi-p-intermediate-140", qty: 2 }], 4);
  assert.equal(wrongQuantity.valid, false);
  assert.equal(wrongQuantity.groups[0].validationCode, "fixed_quantity_mismatch");
});

test("17: a modular rule without the scaling flag keeps its static fixed quantity", () => {
  const evaluation = evaluateOxiCompanion([{ rowId: "oxi-p-starter-140", qty: 1 }, { rowId: "oxi-p-intermediate-140", qty: 2 }], 2, false);
  assert.equal(evaluation.groups[0].fixedQuantity, 2, "Unscaled modular rules must not multiply by selected quantity");
  assert.equal(evaluation.valid, true);
});

test("14-16: Base/Model, Workstation and Price Matrix fixed quantities stay static", () => {
  (["base_model", "workstation", "price_matrix"] as const).forEach((kind) => {
    const evaluation = evaluateAccessoryConfigurationForModel({
      accessoryGroups: [{
        id: "companion",
        group_name: "Companion",
        items: [{ id: "companion-item", item_name: "ART.058", price: 69, is_active: true }],
        conditional_configuration: {
          role: "companion",
          selection: "at_least_one",
          applicability: [{ target: { kind, group_id: "group-1", row_id: "row-1" }, required: true, visible: true, fixed_quantity: 2 }],
        },
      }],
      baseModelGroupId: null,
      baseModelRowId: null,
      selectedModelTargets: [{ kind, group_id: "group-1", row_id: "row-1" }],
      // Even when quantity context exists, an unscaled rule must ignore it.
      selectedModelTargetQuantities: { [accessoryApplicabilityTargetKey({ kind, group_id: "group-1", row_id: "row-1" })]: 5 },
      selectedQuantitiesByGroupId: { companion: { "companion-item": 2 } },
    });
    assert.equal(evaluation.groups[0].fixedQuantity, 2, `Expected ${kind} fixed quantity to stay static`);
    assert.equal(evaluation.valid, true);
  });
});

test("quantity scaling is rejected for non-modular targets and for exactly-one selections", () => {
  const nonModular = evaluateAccessoryConfigurationForModel({
    accessoryGroups: [{
      id: "companion", group_name: "Companion", items: [{ id: "item", item_name: "Item", price: 1, is_active: true }],
      conditional_configuration: { role: "companion", selection: "at_least_one", applicability: [{ target: { kind: "workstation", group_id: "g", row_id: "r" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true }] },
    }],
    baseModelGroupId: null, baseModelRowId: null,
    selectedModelTargets: [{ kind: "workstation", group_id: "g", row_id: "r" }],
    selectedQuantitiesByGroupId: {},
  });
  assert.equal(nonModular.valid, false);
  assert.ok(nonModular.issues.some((issue) => issue.code === "invalid_quantity_scaling"));

  const exactlyOne = evaluateAccessoryConfigurationForModel({
    accessoryGroups: [{
      id: "companion", group_name: "Companion", items: [{ id: "item", item_name: "Item", price: 1, is_active: true }],
      conditional_configuration: { role: "companion", selection: "exactly_one", applicability: [{ target: { kind: "modular", group_id: "g", row_id: "r" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true }] },
    }],
    baseModelGroupId: null, baseModelRowId: null,
    selectedModelTargets: [{ kind: "modular", group_id: "g", row_id: "r" }],
    selectedQuantitiesByGroupId: {},
  });
  assert.equal(exactlyOne.valid, false);
  assert.ok(exactlyOne.issues.some((issue) => issue.code === "invalid_cardinality"));
});

test("12b: mixing a scaled and an unscaled rule for one group reports a conflict instead of silently combining", () => {
  const evaluation = evaluateAccessoryConfigurationForModel({
    accessoryGroups: [{
      id: "companion", group_name: "Companion", items: [{ id: "item", item_name: "Item", price: 1, is_active: true }],
      conditional_configuration: {
        role: "companion", selection: "at_least_one",
        applicability: [
          { target: { kind: "modular", group_id: "g", row_id: "a" }, required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true },
          { target: { kind: "modular", group_id: "g", row_id: "b" }, required: true, visible: true, fixed_quantity: 3 },
        ],
      },
    }],
    baseModelGroupId: null, baseModelRowId: null,
    selectedModelTargets: [{ kind: "modular", group_id: "g", row_id: "a" }, { kind: "modular", group_id: "g", row_id: "b" }],
    selectedModelTargetQuantities: { [accessoryApplicabilityTargetKey({ kind: "modular", group_id: "g", row_id: "a" })]: 2 },
    selectedQuantitiesByGroupId: { companion: { item: 7 } },
  });
  assert.equal(evaluation.groups[0].validationCode, "conflicting_fixed_quantity");
  assert.equal(evaluation.valid, false);
});

test("21: composition identity survives a snapshot round trip without SQL", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(oxiDirectGroup());
  const group = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!).groups[0];
  const quantities: Record<string, number> = { "oxi-p-starter-140": 1, "oxi-p-intermediate-140": 2 };
  const snapshot = group.items
    .filter((row) => (quantities[row.id] ?? 0) > 0)
    .map((row) => ({
      group_id: group.id,
      row_id: row.id,
      pricing_mode: "direct" as const,
      modular_role: modularRowRole(row),
      qty: quantities[row.id],
      price: directPrice(row),
      total: directPrice(row) * quantities[row.id],
      importantRequirements: "importantRequirements" in row ? row.importantRequirements : undefined,
    }));
  const restored = JSON.parse(JSON.stringify({ items: snapshot, composition_summary: "Starter bench 140 × 1 + Intermediate bench 140 × 2" }));
  assert.equal(restored.items.length, 2);
  assert.equal(restored.items[0].modular_role, "starter");
  assert.equal(restored.items[1].modular_role, "intermediate");
  assert.equal(restored.items[1].qty, 2);
  assert.equal(restored.items[1].total, 842);
  assert.deepEqual(restored.items[0].importantRequirements, ["Move the panel to terminal position to finish the composition."]);
  assert.equal(restored.composition_summary, "Starter bench 140 × 1 + Intermediate bench 140 × 2");
  // The terminal instruction stays an instruction: no terminal SKU or price was invented.
  assert.equal(group.items.length, 2);
  assert.ok(!group.items.some((row) => modularRowRole(row) === "terminal"));
});

test("selectionFamily: parses and normalizes an optional non-empty trimmed string, and omits when absent", () => {
  const withFamily = baseDraft();
  withFamily.pricing.modularGroups.push({ ...directGroup("group-a", "  shared-family  ") });
  const normalized = normalizeProductTemplateDraft(withFamily);
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));
  assert.equal(normalized.draft!.pricing.modularGroups[0].selectionFamily, "shared-family");

  const withoutFamily = baseDraft();
  withoutFamily.pricing.modularGroups.push(directGroup("group-b"));
  const normalizedWithout = normalizeProductTemplateDraft(withoutFamily);
  assert.equal(normalizedWithout.valid, true);
  assert.equal("selectionFamily" in normalizedWithout.draft!.pricing.modularGroups[0], false, "Expected the key to be fully omitted, not set to null/undefined");
});

test("selectionFamily: an empty/blank string normalizes away (absent field remains backward-compatible)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push({ ...directGroup("group-a"), selectionFamily: "   " });
  const normalized = normalizeProductTemplateDraft(draft);
  assert.equal(normalized.valid, true);
  assert.equal("selectionFamily" in normalized.draft!.pricing.modularGroups[0], false);
});

test("selectionFamily: existing OXI_P-style templates without the field behave exactly as before (backward compatibility)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(oxiDirectGroup());
  const group = normalizeProductTemplateDraft(draft).draft!.pricing.modularGroups[0];
  assert.equal("selectionFamily" in group, false);
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!).groups[0];
  assert.equal(modularSelectionFamily(mapped), null);
});

test("selectionFamily: persists through draft normalize -> Apply -> Product Template editor save -> reopen", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(directGroup("group-a", "shared-family"), directGroup("group-b", "shared-family"));
  const normalized = normalizeProductTemplateDraft(draft);
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));

  // Apply: draft -> runtime category_pricing rows.
  const mapped = mapDraftModularPricing(normalized.draft!);
  assert.equal(mapped.compatible, true);
  assert.equal(modularSelectionFamily(mapped.groups.find((group) => group.id === "group-a")!), "shared-family");
  assert.equal(modularSelectionFamily(mapped.groups.find((group) => group.id === "group-b")!), "shared-family");

  // Product Template editor save: the editor's raw JSON payload round-trips through the same
  // server-side normalizer used by the template save action.
  const saved = categoryPricingValue(
    "[]",
    JSON.stringify(mapped.groups),
    "{}",
  );
  const savedGroupA = saved.find((row) => row.id === "group-a") as { modular_selection_family?: string | null } | undefined;
  const savedGroupB = saved.find((row) => row.id === "group-b") as { modular_selection_family?: string | null } | undefined;
  assert.equal(savedGroupA?.modular_selection_family, "shared-family");
  assert.equal(savedGroupB?.modular_selection_family, "shared-family");

  // Reopen: Product Library reads the same persisted runtime shape via the generic reader.
  assert.equal(modularSelectionFamily(savedGroupA!), "shared-family");
  assert.equal(modularSelectionFamily(savedGroupB!), "shared-family");
});

test("selectionFamily: Product Library detects the active group within a family from selected quantities", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(directGroup("group-a", "shared-family"), directGroup("group-b", "shared-family"));
  const groups = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!).groups;

  assert.equal(activeModularSelectionFamilyGroupId(groups, "shared-family", () => 0), null, "No group active before any selection");
  assert.equal(
    activeModularSelectionFamilyGroupId(groups, "shared-family", (groupId, rowId) => (groupId === "group-a" && rowId === "group-a-starter" ? 1 : 0)),
    "group-a",
  );
});

test("selectionFamily: selecting a second group in the same family is blocked (server-authoritative)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(directGroup("group-a", "shared-family"), directGroup("group-b", "shared-family"));
  const groups = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!).groups;
  const quantities: Record<string, number> = { "group-a-starter": 1, "group-b-starter": 1 };
  const issue = validateModularSelectionFamilyConflicts(groups, (_groupId, rowId) => quantities[rowId] ?? 0);
  assert.equal(issue?.code, "conflicting_modular_selection_family");
  assert.equal(issue?.message, "More than one alternative modular configuration has been selected. Keep only one configuration from this family.");
  // The shared validator used by both the Product Library and the quotation submit action surfaces the same issue.
  assert.equal(validateModularCompositionGroups(groups, (_groupId, rowId) => quantities[rowId] ?? 0)?.code, "conflicting_modular_selection_family");
});

test("selectionFamily: clearing the first group's quantities allows a second group to become active", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(directGroup("group-a", "shared-family"), directGroup("group-b", "shared-family"));
  const groups = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!).groups;
  const clearedThenSecond: Record<string, number> = { "group-a-starter": 0, "group-b-starter": 1 };
  assert.equal(validateModularSelectionFamilyConflicts(groups, (_groupId, rowId) => clearedThenSecond[rowId] ?? 0), null);
  assert.equal(
    activeModularSelectionFamilyGroupId(groups, "shared-family", (groupId, rowId) => clearedThenSecond[rowId] ?? 0),
    "group-b",
  );
});

test("selectionFamily: two groups with different family ids may coexist", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(directGroup("group-a", "family-one"), directGroup("group-b", "family-two"));
  const groups = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!).groups;
  const bothSelected: Record<string, number> = { "group-a-starter": 1, "group-b-starter": 1 };
  assert.equal(validateModularSelectionFamilyConflicts(groups, (_groupId, rowId) => bothSelected[rowId] ?? 0), null, "Different families never conflict");
});

test("selectionFamily: groups with no selectionFamily remain unchanged and never conflict with each other", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(directGroup("group-a"), directGroup("group-b"));
  const groups = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!).groups;
  const bothSelected: Record<string, number> = { "group-a-starter": 1, "group-b-starter": 1 };
  assert.equal(validateModularSelectionFamilyConflicts(groups, (_groupId, rowId) => bothSelected[rowId] ?? 0), null);
  assert.equal(activeModularSelectionFamilyGroupId(groups, "shared-family", () => 1), null, "No family means no active-group tracking");
});

test("selectionFamily: server accepts exactly one selected group in a family, and different families independently", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(directGroup("group-a", "shared-family"), directGroup("group-b", "shared-family"), directGroup("group-c", "another-family"));
  const groups = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!).groups;
  const oneSelected: Record<string, number> = { "group-a-starter": 1, "group-c-starter": 1 };
  assert.equal(validateModularSelectionFamilyConflicts(groups, (_groupId, rowId) => oneSelected[rowId] ?? 0), null);
});

test("selectionFamily: Matrix Modular groups are never constrained by selectionFamily conflicts", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroup("matrix-a"), matrixGroup("matrix-b"));
  const groups = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!).groups;
  // Even if a matrix group somehow carried a selectionFamily-shaped value, the family check only
  // ever looks at Direct Modular groups; matrix rows keep behaving exactly as before.
  (groups[0] as { modular_selection_family?: string }).modular_selection_family = "shared-family";
  (groups[1] as { modular_selection_family?: string }).modular_selection_family = "shared-family";
  const bothSelected: Record<string, number> = { corner: 1 };
  assert.equal(validateModularSelectionFamilyConflicts(groups, () => bothSelected.corner ?? 0), null);
});

test("selectionFamily: OXI_P Direct Modular composition and ART.058 companion scaling are unaffected", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(oxiDirectGroup());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups[0];
  const quantities: Record<string, number> = { "oxi-p-starter-140": 1, "oxi-p-intermediate-140": 2 };
  assert.equal(validateModularCompositionGroups([group], (_groupId, rowId) => quantities[rowId] ?? 0), null);
  const evaluation = evaluateOxiCompanion([{ rowId: "oxi-p-starter-140", qty: 1 }, { rowId: "oxi-p-intermediate-140", qty: 2 }], 6);
  assert.equal(evaluation.groups[0].fixedQuantity, 6);
  assert.equal(evaluation.valid, true);
});

test("Matrix Modular: row role normalizes on Matrix rows (1)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroupWithRoles());
  const normalized = normalizeProductTemplateDraft(draft);
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));
  const group = normalized.draft!.pricing.modularGroups[0];
  assert.equal(isDirectModularGroup(group), false, "Expected the group to remain Matrix Modular by structure");
  assert.equal(group.matrix!.rows[0].role, "starter");
  assert.equal(group.matrix!.rows[1].role, "intermediate");
});

test("Matrix Modular: group composition normalizes for a Matrix group (2)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroupWithRoles());
  const normalized = normalizeProductTemplateDraft(draft);
  assert.equal(normalized.valid, true);
  const group = normalized.draft!.pricing.modularGroups[0];
  assert.deepEqual(group.composition, { minStarters: 1, maxStarters: 1 });
});

test("Matrix Modular: composition validation rejects an unknown role and a starterless composition exactly as Direct Modular does", () => {
  const badRole = baseDraft();
  badRole.pricing.modularGroups.push({ ...matrixGroupWithRoles(), matrix: { ...matrixGroupWithRoles().matrix, rows: [{ id: "row", label: "Row", role: "middle", prices: {} }] } });
  assert.equal(normalizeProductTemplateDraft(badRole).valid, false);

  const noStarterRow = baseDraft();
  noStarterRow.pricing.modularGroups.push({ ...matrixGroupWithRoles(), matrix: { ...matrixGroupWithRoles().matrix, rows: [{ id: "row", label: "Row", role: "intermediate", prices: {} }] } });
  assert.equal(normalizeProductTemplateDraft(noStarterRow).valid, false);
});

test("Matrix Modular: role survives Draft -> Apply (3)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroupWithRoles());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups.find((group) => group.id === "composed-matrix")!;
  assert.ok(group, "Expected the Matrix Modular group to map to runtime");
  assert.equal(modularRowRole(group.items[0]), "starter");
  assert.equal(modularRowRole(group.items[1]), "intermediate");
  assert.equal(isDirectModularPricingGroup(group), false, "Expected Apply to keep the group matrix-mode, never scalar-priced");
});

test("Matrix Modular: composition survives Draft -> Apply (4)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroupWithRoles());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups.find((group) => group.id === "composed-matrix")!;
  assert.deepEqual(modularCompositionRule(group), { minStarters: 1, maxStarters: 1 });
});

test("Matrix Modular: price maps and matrix columns survive Draft -> Apply unchanged (7)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroupWithRoles());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups.find((group) => group.id === "composed-matrix")!;
  assert.deepEqual(group.price_categories, ["Standard", "Designs"]);
  assert.deepEqual(group.items[0].prices, { Standard: 1310, Designs: 1874 });
  assert.deepEqual(group.items[1].prices, { Standard: 1454, Designs: 2148 });
});

test("Matrix Modular: unavailableCategoryIds survive Draft -> Apply unchanged (8)", () => {
  const draft = baseDraft();
  const groupWithUnavailable = matrixGroupWithRoles();
  (groupWithUnavailable.matrix.rows[1] as { unavailableCategoryIds?: string[] }).unavailableCategoryIds = ["designs"];
  draft.pricing.modularGroups.push(groupWithUnavailable);
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups.find((group) => group.id === "composed-matrix")!;
  assert.deepEqual(group.items[0].unavailable_categories, []);
  assert.deepEqual(group.items[1].unavailable_categories, ["Designs"]);
});

test("Matrix Modular: an add-on/intermediate-only selection is invalid without a starter (9)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroupWithRoles());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups.find((group) => group.id === "composed-matrix")!;
  const quantities: Record<string, number> = { "composed-matrix-intermediate": 1 };
  const issue = validateModularCompositionGroups([group], (_groupId, rowId) => quantities[rowId] ?? 0);
  assert.equal(issue?.code, "starter_missing_for_intermediate");
});

test("Matrix Modular: a starter-only selection passes when the composition allows it (10)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroupWithRoles());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups.find((group) => group.id === "composed-matrix")!;
  const quantities: Record<string, number> = { "composed-matrix-starter": 1 };
  assert.equal(validateModularCompositionGroups([group], (_groupId, rowId) => quantities[rowId] ?? 0), null);
});

test("Matrix Modular: starter + intermediate selection passes (11)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroupWithRoles());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups.find((group) => group.id === "composed-matrix")!;
  const quantities: Record<string, number> = { "composed-matrix-starter": 1, "composed-matrix-intermediate": 2 };
  assert.equal(validateModularCompositionGroups([group], (_groupId, rowId) => quantities[rowId] ?? 0), null);
});

test("Matrix Modular: selecting more starters than maxStarters fails (12)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroupWithRoles());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups.find((group) => group.id === "composed-matrix")!;
  // Force two selected starters against a maxStarters: 1 rule by pretending the intermediate row is also a starter selection count-wise via a second quantity on the same starter row id is not possible;
  // instead prove the bound using evaluateModularComposition directly with two starter selections.
  const rule = modularCompositionRule(group)!;
  const twoStarters = [
    { qty: 2, roleValue: "starter" as const, rowId: "a" },
  ];
  assert.equal(evaluateModularComposition(rule, twoStarters)?.code, "too_many_starters");
});

test("Direct Modular composition/role regression: unaffected by generic Matrix Modular support (13)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(oxiDirectGroup());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups[0];
  assert.equal(isDirectModularPricingGroup(group), true);
  assert.deepEqual(modularCompositionRule(group), { minStarters: 1, maxStarters: 1 });
  const quantities: Record<string, number> = { "oxi-p-starter-140": 1, "oxi-p-intermediate-140": 1 };
  assert.equal(validateModularCompositionGroups([group], (_groupId, rowId) => quantities[rowId] ?? 0), null);
});

test("OXI_P regression: starter/intermediate composition and ART.058 scaling remain unaffected (14)", () => {
  const evaluation = evaluateOxiCompanion([{ rowId: "oxi-p-starter-140", qty: 1 }, { rowId: "oxi-p-intermediate-140", qty: 1 }], 4);
  assert.equal(evaluation.groups[0].fixedQuantity, 4);
  assert.equal(evaluation.valid, true);
});

test("X3 selectionFamily regression: exclusivity enforcement remains unaffected by generic Matrix Modular composition support (15)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(directGroup("group-a", "shared-family"), directGroup("group-b", "shared-family"));
  const groups = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!).groups;
  const bothSelected: Record<string, number> = { "group-a-starter": 1, "group-b-starter": 1 };
  const issue = validateModularSelectionFamilyConflicts(groups, (_groupId, rowId) => bothSelected[rowId] ?? 0);
  assert.equal(issue?.code, "conflicting_modular_selection_family");
});

test("Matrix Modular without role/composition remains fully backward compatible (16)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroup());
  const normalized = normalizeProductTemplateDraft(draft);
  assert.equal(normalized.valid, true);
  const group = normalized.draft!.pricing.modularGroups[0];
  assert.equal("role" in group.matrix!.rows[0], false);
  assert.equal("composition" in group, false);
  const mapped = mapDraftModularPricing(normalized.draft!);
  const runtimeGroup = mapped.groups.find((group) => group.id === "sofa-modules")!;
  assert.equal(modularRowRole(runtimeGroup.items[0]), null);
  assert.equal(modularCompositionRule(runtimeGroup), null);
  assert.equal(validateModularCompositionGroups([runtimeGroup], () => 0), null);
});

test("Server validator (validateModularCompositionGroups, the same function used by the quotation submit action) catches an invalid Matrix Modular composition (17)", () => {
  const draft = baseDraft();
  draft.pricing.modularGroups.push(matrixGroupWithRoles());
  const mapped = mapDraftModularPricing(normalizeProductTemplateDraft(draft).draft!);
  const group = mapped.groups.find((group) => group.id === "composed-matrix")!;
  // Simulate the server action's own quantity lookup shape: `(groupId, rowId) => ...`.
  const submittedQuantities: Record<string, number> = { "composed-matrix-intermediate": 3 };
  const issue = validateModularCompositionGroups(
    [group],
    (groupId, rowId) => (groupId === group.id ? submittedQuantities[rowId] ?? 0 : 0),
  );
  assert.equal(issue?.code, "starter_missing_for_intermediate", "Expected the shared server-authoritative validator to reject an intermediate-only Matrix Modular submission");
});
