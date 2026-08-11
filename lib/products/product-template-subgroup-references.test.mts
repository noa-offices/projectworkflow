import assert from "node:assert/strict";
import test from "node:test";
import { baseModelSubgroupReferenceKey } from "./base-model-pricing-subgroups.js";
import { persistedProductTemplateSubgroupKeys, productTemplateSubgroupReferencePath, reconcileStaleProductTemplateSubgroupReferences, resolveProductTemplateSubgroupIdentity, staleProductTemplateSubgroupReferences, type ProductTemplateSubgroupReferenceRow } from "./product-template-subgroup-references.js";

const pricing = [{ id: "g", pricing_type: "base_model_group", group_name: "Group", is_active: true, sort_order: 0, items: [{ id: "r" }], subgroups: [{ id: "s", subgroup_name: "Renamed", sort_order: 4, is_active: true, row_ids: ["r"] }] }];
const reference = { id: "ref", template_id: "t", pricing_type: "base_model", group_id: "g", subgroup_id: "s", storage_path: "p", caption: null, created_at: "", updated_at: "" } satisfies ProductTemplateSubgroupReferenceRow;

test("subgroup image identity includes template pricing group and subgroup", () => { assert.notEqual(baseModelSubgroupReferenceKey("base_model", "g1", "s"), baseModelSubgroupReferenceKey("base_model", "g2", "s")); assert.match(productTemplateSubgroupReferencePath("t", "base_model", "g", "s", "ref"), /\/g\/s\/ref\.webp$/); });
test("subgroup identity and image survive rename/reorder", () => { assert.deepEqual(resolveProductTemplateSubgroupIdentity(pricing, "base_model", "s"), { groupId: "g", subgroupId: "s" }); assert.ok(persistedProductTemplateSubgroupKeys(pricing).has(baseModelSubgroupReferenceKey("base_model", "g", "s"))); assert.deepEqual(staleProductTemplateSubgroupReferences([reference], persistedProductTemplateSubgroupKeys(pricing)), []); });
test("deleted subgroup becomes stale without affecting row references", () => { const without = [{ ...pricing[0], subgroups: [] }]; assert.deepEqual(staleProductTemplateSubgroupReferences([reference], persistedProductTemplateSubgroupKeys(without)), [reference]); });
test("post-save stale cleanup is DB-first and storage failure is non-fatal", async () => {
  const events: string[] = []; const warnings: string[] = [];
  const removed = await reconcileStaleProductTemplateSubgroupReferences({ references: [reference], persistedKeys: new Set(), deleteReference: async (item) => { events.push(`db:${item.id}`); }, deleteStorageObject: async (item) => { events.push(`storage:${item.id}`); throw new Error("storage"); }, onReferenceDeleteError: (item) => { warnings.push(`db:${item.id}`); }, onStorageDeleteError: (item) => { warnings.push(`storage:${item.id}`); } });
  assert.equal(removed, 1); assert.deepEqual(events, ["db:ref", "storage:ref"]); assert.deepEqual(warnings, ["storage:ref"]);
});
