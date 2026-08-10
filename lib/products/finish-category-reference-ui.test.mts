import assert from "node:assert/strict";
import test from "node:test";
import {
  finishCategoryReferenceAvailability,
  finishCategoryReferenceScope,
  persistedPricingGroupIds,
  persistedFinishCategoryGroupIds,
  pricingGroupReferenceScope,
  persistedWorkstationPricingGroupIds,
  workstationPricingGroupReferenceAvailability,
  persistedBaseModelPricingGroupIds,
  baseModelPricingGroupReferenceAvailability,
} from "./finish-category-reference-ui.js";

test("uses the exact Finish/Category scope and isolates groups", () => {
  const groupA = finishCategoryReferenceScope("template-1", "group-a");
  const groupB = finishCategoryReferenceScope("template-1", "group-b");
  assert.deepEqual(groupA, {
    templateId: "template-1",
    pricingType: "finish_category",
    groupId: "group-a",
  });
  assert.notDeepEqual(groupA, groupB);
});

test("recognizes only persisted Finish/Category group ids without mutating pricing", () => {
  const rows = [
    { id: "finish-a", group_name: "Fabric", items: [] },
    { id: "modular-a", pricing_type: "modular_group", group_name: "Modules", items: [] },
    { group_name: "Missing id", items: [] },
  ];
  const before = structuredClone(rows);
  assert.deepEqual([...persistedFinishCategoryGroupIds(rows)], ["finish-a"]);
  assert.deepEqual(rows, before);
});

test("blocks unsaved templates and newly-added local groups before upload", () => {
  const ids = new Set(["finish-a"]);
  assert.deepEqual(
    finishCategoryReferenceAvailability({ templateIsPersisted: false, persistedGroupIds: ids, groupId: "finish-a" }),
    {
      available: false,
      message: "Save the Product Template once before adding group reference images.",
    },
  );
  assert.deepEqual(
    finishCategoryReferenceAvailability({ templateIsPersisted: true, persistedGroupIds: ids, groupId: "new-local-group" }),
    {
      available: false,
      message: "Save the Product Template before adding reference images to this new group.",
    },
  );
  assert.deepEqual(
    finishCategoryReferenceAvailability({ templateIsPersisted: true, persistedGroupIds: ids, groupId: "finish-a" }),
    { available: true, message: null },
  );
});

test("uses persisted Modular and Accessory ids with isolated pricing-type scopes", () => {
  const categoryRows = [
    { id: "finish-a", group_name: "Same label", items: [] },
    { id: "modular-a", pricing_type: "modular_group", group_name: "Same label", items: [] },
  ];
  const accessoryRows = [{ id: "accessory-a", group_name: "Same label", items: [] }];
  const categoryBefore = structuredClone(categoryRows);
  const accessoryBefore = structuredClone(accessoryRows);

  assert.deepEqual([...persistedPricingGroupIds(categoryRows, "modular")], ["modular-a"]);
  assert.deepEqual([...persistedPricingGroupIds(accessoryRows, "accessory")], ["accessory-a"]);
  assert.notDeepEqual(
    pricingGroupReferenceScope("template-1", "modular", "modular-a"),
    pricingGroupReferenceScope("template-1", "accessory", "modular-a"),
  );
  assert.notDeepEqual(
    pricingGroupReferenceScope("template-1", "finish_category", "finish-a"),
    pricingGroupReferenceScope("template-1", "modular", "finish-a"),
  );
  assert.deepEqual(categoryRows, categoryBefore);
  assert.deepEqual(accessoryRows, accessoryBefore);
});

test("Workstation references require explicit saved groups and keep scopes isolated", () => {
  const explicit = [{ id: "workstation-a", pricing_type: "workstation_group", group_name: "Standard", is_active: true, sort_order: 0, items: [] }];
  const legacy = [{ id: "row-1", label: "120 x 60" }];
  const before = structuredClone(explicit);

  assert.deepEqual([...persistedWorkstationPricingGroupIds(explicit)], ["workstation-a"]);
  assert.deepEqual([...persistedWorkstationPricingGroupIds(legacy)], []);
  assert.deepEqual(explicit, before);
  assert.deepEqual(
    workstationPricingGroupReferenceAvailability({ templateIsPersisted: false, persistedGroupIds: new Set(["workstation-a"]), groupId: "workstation-a" }),
    { available: false, message: "Save the Product Template once before adding group reference images." },
  );
  assert.deepEqual(
    workstationPricingGroupReferenceAvailability({ templateIsPersisted: true, persistedGroupIds: new Set(), groupId: "legacy-workstation-main" }),
    { available: false, message: "Save the Product Template before adding reference images to this Workstation group." },
  );
  assert.deepEqual(
    workstationPricingGroupReferenceAvailability({ templateIsPersisted: true, persistedGroupIds: new Set(["workstation-a"]), groupId: "new-local" }),
    { available: false, message: "Save the Product Template before adding reference images to this new group." },
  );
  assert.deepEqual(
    workstationPricingGroupReferenceAvailability({ templateIsPersisted: true, persistedGroupIds: new Set(["workstation-a"]), groupId: "workstation-a" }),
    { available: true, message: null },
  );
  assert.notDeepEqual(
    pricingGroupReferenceScope("template-1", "workstation", "workstation-a"),
    pricingGroupReferenceScope("template-1", "workstation", "workstation-b"),
  );
});

test("Base / Model references require explicit saved groups and keep legacy synthetic groups blocked", () => {
  const explicit = [{ id: "base-model-a", pricing_type: "base_model_group", group_name: "Executive", is_active: true, sort_order: 0, items: [] }];
  const legacy = [{ id: "row-1", variant_name: "Model A" }];
  const before = structuredClone(explicit);

  assert.deepEqual([...persistedBaseModelPricingGroupIds(explicit)], ["base-model-a"]);
  assert.deepEqual([...persistedBaseModelPricingGroupIds(legacy)], []);
  assert.deepEqual(explicit, before);
  assert.deepEqual(
    baseModelPricingGroupReferenceAvailability({ templateIsPersisted: false, persistedGroupIds: new Set(["base-model-a"]), groupId: "base-model-a" }),
    { available: false, message: "Save the Product Template once before adding group reference images." },
  );
  assert.deepEqual(
    baseModelPricingGroupReferenceAvailability({ templateIsPersisted: true, persistedGroupIds: new Set(), groupId: "legacy-base-model-main" }),
    { available: false, message: "Save the Product Template before adding reference images to this Base / Model group." },
  );
  assert.deepEqual(
    baseModelPricingGroupReferenceAvailability({ templateIsPersisted: true, persistedGroupIds: new Set(), groupId: "new-local" }),
    { available: false, message: "Save the Product Template before adding reference images to this new group." },
  );
  assert.deepEqual(
    baseModelPricingGroupReferenceAvailability({ templateIsPersisted: true, persistedGroupIds: new Set(["base-model-a"]), groupId: "base-model-a" }),
    { available: true, message: null },
  );
  assert.notDeepEqual(
    pricingGroupReferenceScope("template-1", "base_model", "base-model-a"),
    pricingGroupReferenceScope("template-1", "base_model", "base-model-b"),
  );
});
