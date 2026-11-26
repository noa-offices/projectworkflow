import assert from "node:assert/strict";
import test from "node:test";
import { buildLinkedFinishSnapshot, documentFinishRows } from "./linked-finish-snapshot";
import { reconfigurationDraft, reconfigureLocalRows, type ReconfigureChanges, type ReconfigureTarget } from "../../components/quotations/local-reconfigure";
import { buildRecipe, restorePlainState, type SavedSetupRecipeV1 } from "../products/saved-setups/recipe";
import { priceConfiguration } from "../products/configuration-price";
import { preparePublication } from "../local/quotation-publication-payload";
import type { LocalQuotationItem, LocalQuotationWorkspace } from "../local/quotation-workspace";

// The shape of a real saved line: finishes are in the recipe, but the line has no linked_finish_snapshot.
const parentId = "11111111-1111-4111-8111-111111111111";
const linkId = "e690c6fa-eb91-48ad-aa18-60ccadd9d60b";
const instanceKey = `${linkId}:${linkId}-default`;
const groupLinkId = "81a6f807-5ead-4184-a987-9d14641e80b2";
const fabrics = [
  ["7f54dbbf-35e1-4681-9b4c-734641377bbd", "528", "Acid green"],
  ["b9f47fd2-3743-4c30-b9af-3785839a9fc5", "529", "Petroleum"],
  ["5a8210cf-a3cc-4795-ae61-e468235f7a81", "530", "Arctic"],
  ["49fe6b51-fdc1-4e0e-80aa-1bf416c97ade", "531", "Light blue"],
  ["1a7e1d26-7c2d-46a9-80ac-e481aeaff871", "527", "Malt"],
];

const recipe = (withFinishes: boolean): SavedSetupRecipeV1 => buildRecipe({
  templateId: parentId,
  linkedInstances: { [linkId]: [`${linkId}-default`] },
  linkedSelections: { [instanceKey]: {
    categoryGroupId: "us-m-fabric-front", categoryId: "us-m-fabric-front-818", quantity: 2,
    accessoryQuantities: { "us-stirrup-883": 1 }, perScreenFixedQuantities: true,
    finishes: withFinishes ? fabrics.map(([id]): [string, string] => [groupLinkId, id]) : undefined,
  } },
}).recipe;

// The same steps Add and Update item use: saved recipe -> replayed state -> pricing core lines -> snapshot.
function configure(saved: SavedSetupRecipeV1) {
  const state = restorePlainState(saved);
  const selection = state.linkedSelections![instanceKey];
  const child = { id: "universal-screen", template_name: "Universal Screen", brand_id: "brand", currency: "EUR", default_unit_price: 100, variant_pricing: [], category_pricing: [], accessory_pricing: [] };
  const price = priceConfiguration({
    template: { id: parentId, template_name: "Oxi_R", brand_id: "brand", currency: "EUR", default_unit_price: 500 },
    configuration: { modularInUse: false, modularItems: [], usesWorkstationFlow: false,
      accessoryConfiguration: { activeQuantities: {} }, selectedAccessoryCategories: {} },
    context: { accessoryGroups: [], linked: [{
      link: { id: linkId, label: "universal Screen", default_qty: 1, add_to_parent_price: true }, childTemplate: child,
      instances: [{ instance: { id: `${linkId}-default`, label: "" }, quantity: selection.quantity ?? undefined,
        accessoryQuantities: selection.accessoryQuantities, perScreenFixedQuantities: true, selection }],
    }] },
  } as unknown as Parameters<typeof priceConfiguration>[0]);
  return buildLinkedFinishSnapshot(
    price.linked as unknown as Parameters<typeof buildLinkedFinishSnapshot>[0],
    Object.fromEntries(Object.entries(state.linkedSelections!).map(([key, value]) => [key, value.finishes ?? []])),
    [{ id: groupLinkId, product_template_id: child.id, material_group_id: "fabric", label_override: null, sort_order: 0,
      selection_mode: "selected_categories", is_required: false, allow_multiple: true, show_in_specification: true, show_in_quotation: false }] as Parameters<typeof buildLinkedFinishSnapshot>[2],
    [{ id: "fabric", brand_id: "brand", group_name: "Fabric", sort_order: 0 }] as Parameters<typeof buildLinkedFinishSnapshot>[3],
    new Map(fabrics.map(([id, code, name]) => [id, { id, material_group_id: "fabric", material_code: code, material_name: name, image_url: null }])) as unknown as Parameters<typeof buildLinkedFinishSnapshot>[4],
  );
}

const savedLine = (saved: SavedSetupRecipeV1) => ({
  id: "saved", quotation_id: "q", section_id: null, item_type: "product", source_template_id: parentId, is_active: true,
  updated_at: "old", qty: 1, unit_price: 789, currency: "AED", sort_order: 10, discount_type: "none", discount_value: 0,
  source_component_data: { configuration_recipe: { recipe: saved, spec_overrides: { specification_edited: false } } },
}) as unknown as LocalQuotationItem;

// Mirrors the Update item handler when nothing but the missing snapshot differs.
function updateItem(line: LocalQuotationItem) {
  const saved = (line.source_component_data as { configuration_recipe: { recipe: SavedSetupRecipeV1 } }).configuration_recipe.recipe;
  const snapshot = configure(saved);
  const changes: ReconfigureChanges = {
    linkedFinishes: JSON.stringify((line.source_component_data as Record<string, unknown>).linked_finish_snapshot) !== JSON.stringify(snapshot),
    configuration: false, price: false, specification: false, dimension: false, image: false,
  };
  const target = { line, setup: { ok: true, templateId: parentId, recipe: saved } } as unknown as ReconfigureTarget;
  const draft = reconfigurationDraft(target, { ...line, updated_at: "now", source_component_data: {
    ...(snapshot && { linked_finish_snapshot: snapshot }), configuration_recipe: { recipe: saved, spec_overrides: { specification_edited: false } },
  } }, changes);
  return { changes, snapshot, items: reconfigureLocalRows([line], line, draft, changes) };
}

// What is sent to the database, after the JSON round trip, read the way the specification page reads it.
function publishedSource(item: LocalQuotationItem) {
  const workspace = { currency: "AED", sections: [], items: [item], layout_settings: {}, metadata: {}, vat_percent: 5,
    overall_discount_type: "amount", overall_discount_value: 0 } as unknown as LocalQuotationWorkspace;
  return JSON.parse(JSON.stringify(preparePublication(workspace, "user").items[0].source_component_data)) as Record<string, unknown>;
}

test("Update item on a saved line with recipe finishes and no snapshot publishes the snapshot", () => {
  const { changes, items } = updateItem(savedLine(recipe(true)));
  assert.equal(changes.linkedFinishes, true);
  const rows = documentFinishRows([], publishedSource(items[0]).linked_finish_snapshot, () => []) as Record<string, unknown>[];
  assert.deepEqual(rows.map((row) => row.finish_code), ["528", "529", "530", "531", "527"]);
  assert.equal(rows[0].group_label, "Universal Screen - universal Screen / Fabric");
});

test("a newly added line publishes the snapshot", () => {
  const snapshot = configure(recipe(true));
  const added = { ...savedLine(recipe(true)), source_component_data: { linked_finish_snapshot: snapshot } };
  assert.deepEqual(publishedSource(added).linked_finish_snapshot, JSON.parse(JSON.stringify(snapshot)));
});

test("Update item with no linked finishes adds no snapshot", () => {
  const line = savedLine(recipe(false));
  const { changes, snapshot, items } = updateItem(line);
  assert.equal(snapshot, undefined);
  assert.equal(changes.linkedFinishes, false);
  assert.equal(Object.hasOwn(publishedSource(items[0]), "linked_finish_snapshot"), false);
});
