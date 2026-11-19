import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { itemLinePricing, type LocalQuotationItem } from "@/lib/local/quotation-workspace";
import { buildLineConfigurationRecipe } from "@/lib/products/saved-setups/line-recipe";
import { canReconfigureLocalQuotation, reconfigurationDraft, reconfigureLocalRows, reconfigureTarget, reconfigureUnitPrice, reconfigureWarnings } from "./local-reconfigure";

const row = {
  id: "target", section_id: "section", source_template_id: "template", source_item_id: "saved",
  item_type: "product", qty: 3, sort_order: 20, discount_type: "amount", discount_value: 12,
  manual_serial: "A", size_snapshot: "manual", specification_snapshot: "edited",
  proposed_image_url_snapshot: "custom", specified_image_url_snapshot: "specified",
  source_component_data: { notes: "keep", dimension: "old generated", category_pricing: { stale: true } },
  cell_layout: { bold: true, images: { proposed_image_url_snapshot: { x: 3 }, specified_image_url_snapshot: { x: 5 } } },
} as unknown as LocalQuotationItem;

test("in-place replacement keeps row fields and merges only configuration metadata", () => {
  const other = { ...row, id: "other" };
  const draft = {
    ...row, id: "new", qty: 1, sort_order: 0, discount_value: 0, unit_price: 100,
    size_snapshot: "generated", specification_snapshot: "new spec", proposed_image_url_snapshot: "new",
    source_component_data: { dimension: "new generated", configuration_recipe: {}, notes: "discard" },
  } as LocalQuotationItem;
  const result = reconfigureLocalRows([other, row], row, draft);
  assert.equal(result.length, 2);
  assert.equal(result[0], other);
  assert.deepEqual(
    [result[1].id, result[1].sort_order, result[1].qty, result[1].discount_value, result[1].manual_serial, result[1].source_item_id],
    ["target", 20, 3, 12, "A", "saved"],
  );
  assert.equal(result[1].unit_price, 100);
  assert.equal(result[1].specified_image_url_snapshot, "specified");
  assert.deepEqual(result[1].source_component_data, { notes: "keep", dimension: "new generated", configuration_recipe: {} });
  assert.equal(reconfigureLocalRows([other], row, draft)[0], other);
  assert.equal(reconfigureLocalRows([other, { ...row, updated_at: "later" }], row, draft)[1].updated_at, "later");
});

test("reprices only the configuration delta and keeps the saved price by default", () => {
  assert.equal(reconfigureUnitPrice("whole_aed_v1", 100, 143.2, 163.8, false, false), 100);
  assert.equal(reconfigureUnitPrice("whole_aed_v1", 100, 143.2, 163.8, true, false), 121);
  assert.equal(reconfigureUnitPrice("round_up_5_legacy", 100, 143.2, 163.8, true, false), 125);
  assert.equal(reconfigureUnitPrice("whole_aed_v1", 100, 143.2, 163.8, true, true), 164);
});

test("warnings show saved versus current price, spec drift, dimension and unavailable choices", () => {
  const warnings = reconfigureWarnings({
    savedPrice: "AED 100", currentPrice: "AED 140", specChanged: true,
    savedDimension: "120", currentDimension: "140", problems: ["Cable tray is unavailable."],
  });
  assert.deepEqual(warnings, [
    "Unit price: AED 100 saved; AED 140 now.",
    "The generated specification changed.",
    "Dimension: 120 saved; 140 now.",
    "Cable tray is unavailable.",
  ]);
});

const templateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const recipe = buildLineConfigurationRecipe({
  templateId, generatedSpecification: "original generated", selectedImage: "product-images/original.webp",
  dimensionOverride: "manual",
});
const configured = {
  ...row, source_template_id: templateId, unit_price: 100, currency: "AED", item_name_snapshot: "Desk",
  source_component_data: { configuration_recipe: recipe, dimension: "old generated" },
};

test("only writable, unlocked product rows with a valid recipe are targets", () => {
  assert.equal(canReconfigureLocalQuotation("designer"), true);
  assert.equal(canReconfigureLocalQuotation(null), false);
  assert.equal(canReconfigureLocalQuotation("warehouse_staff"), false);
  assert.equal(reconfigureTarget(configured, true, {})?.line.id, configured.id);
  assert.equal(reconfigureTarget(configured, false, {}), null);
  assert.equal(reconfigureTarget(configured, true, { variationApplied: { orderNo: "OR-1", variationNo: 1 } }), null);
  assert.equal(reconfigureTarget({ ...configured, item_type: "custom" }, true, {}), null);
  assert.equal(reconfigureTarget(row, true, {}), null);
});

test("retains manual text, dimension and image when only the configuration and price snapshots change", () => {
  const target = reconfigureTarget(configured, true, {});
  assert.ok(target?.setup.specOverrides.specification_edited);
  const next = { ...configured, specification_snapshot: "new generated", size_snapshot: "new size", proposed_image_url_snapshot: "new image" };
  const changes = { configuration: true, price: true, specification: false, dimension: false, image: false };
  const draft = reconfigurationDraft(target, next, changes);
  const [updated] = reconfigureLocalRows([configured], configured, draft, changes);
  assert.equal(updated.specification_snapshot, "edited");
  assert.equal(updated.size_snapshot, "manual");
  assert.equal(updated.proposed_image_url_snapshot, "custom");
  assert.equal(updated.cell_layout, configured.cell_layout);
  assert.equal(updated.specified_image_url_snapshot, "specified");
});

for (const rule of ["whole_aed_v1", "round_up_5_legacy"] as const) {
  test(`replacement prices the retained quantity and fixed or percent discount with ${rule}`, () => {
    for (const discount_type of ["amount", "percent"] as const) {
      const saved = { ...configured, discount_type, discount_value: 10 };
      const draft = { ...saved, unit_price: 200, qty: 1, discount_type: "none", discount_value: 0 };
      const [updated] = reconfigureLocalRows([saved], saved, draft);
      assert.equal(updated.discount_type, discount_type);
      assert.equal(updated.discount_value, 10);
      assert.equal(updated.qty, 3);
      assert.equal(itemLinePricing(updated, rule).netTotal, discount_type === "amount" ? 570 : 540);
    }
  });
}

test("local selector is isolated by target ID and cancel only clears that target", () => {
  const builder = readFileSync(new URL("./local-quotation-builder.tsx", import.meta.url), "utf8");
  const selector = readFileSync(new URL("./product-library-selector.tsx", import.meta.url), "utf8");
  assert.match(builder, /key=\{reconfiguring\.line\.id\}/);
  assert.match(builder, /onClose: \(\) => setReconfiguring\(null\)/);
  assert.match(builder, /reconfigureButton\(item\)/);
  assert.match(builder, /reconfigureButton\(item, true\)/);
  assert.match(selector, /if \(reconfigure\) reconfigure\.onClose\(\);/);
  assert.match(selector, /const existingAddBlocked = missingExchangeRate/);
  assert.match(selector, /reconfigure\.onUpdate\(savedLine\.id, draft, changes\)/);
  assert.match(selector, /action=\{reconfigure \? undefined : addProductTemplateToQuotation\}/);
});
