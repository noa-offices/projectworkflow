import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { serializeBaseModelPricingGroups } from "../products/base-model-pricing-groups.js";
import { normalizeBaseModelEditorRow } from "../products/base-model-editor-row.js";
import { parseBaseModelPricingJson } from "../products/base-model-pricing-parser.js";
import { mapDraftBaseModelPricing } from "../products/product-template-draft-base-model-adapter.js";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "../products/product-template-draft.js";
import { productTemplateRowReferenceKey } from "../products/product-template-row-references.js";
import { activeBaseModelPricingGroups, nativeSystemState, normalizeSystemQuantity, systemPriceContribution } from "./native-system-base.js";

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, displayName: id, price: 100, currency: "EUR", supplierCodes: [`1AJ ${id}`], referenceCodes: [], ...extra });
const draft = () => {
  const result = normalizeProductTemplateDraft({
    version: 1, template: { templateName: "sigma test" }, defaultCurrency: "EUR",
    pricing: { workstationRows: [], baseModelRows: [
      row("M33", { groupId: "comby-system", groupLabel: "COMBY System", role: "system_base", price: 377 }),
      row("M45", { groupId: "comby-system", groupLabel: "COMBY System", price: 310 }),
    ], priceMatrices: [], modularGroups: [] },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 1, sources: [],
  });
  assert.ok(result.draft, JSON.stringify(result.errors));
  return result.draft as ProductTemplateDraft;
};

// Smart Setup Apply -> editor state -> hidden variant_pricing field (the exact serializer the editor uses)
const editorSerialized = () => {
  const applied = mapDraftBaseModelPricing(draft());
  return JSON.stringify(serializeBaseModelPricingGroups(applied.groups.map((group) => ({ ...group, items: group.items.map((item, index) => normalizeBaseModelEditorRow(item, index)) }))));
};

test("Apply writes role, the editor serialization keeps it, the server parse keeps it (persisted shape of the System row)", () => {
  const applied = mapDraftBaseModelPricing(draft());
  assert.equal((applied.groups[0].items.find((item) => item.id === "M33") as { role?: string }).role, "system_base");
  const persisted = parseBaseModelPricingJson(editorSerialized()) as Array<{ id: string; items: Array<Record<string, unknown>> }>;
  const system = persisted[0].items.find((item) => item.id === "M33")!;
  assert.equal(system.role, "system_base");
  assert.equal(system.supplier_price_list_code, "1AJ M33");
  assert.equal(system.price, 377);
  assert.equal(persisted[0].items.find((item) => item.id === "M45")!.role, undefined, "Main rows stay role-less");
});

test("a persisted native template is recognized by the Product Library load path: System card data, quantity, price and image key", () => {
  const persisted = parseBaseModelPricingJson(editorSerialized());
  const groups = activeBaseModelPricingGroups(persisted);
  const state = nativeSystemState(groups, undefined);
  assert.equal(state.active, true);
  assert.equal(state.selected?.row.id, "M33", "the only System row is selected automatically");
  assert.equal(state.selected?.row.supplier_price_list_code, "1AJ M33");
  assert.deepEqual(state.eligibleGroups.flatMap((group) => group.items.map((item) => item.id)), ["M45"], "the System row never appears in the Main model list");
  const quantity = normalizeSystemQuantity(undefined);
  assert.equal(quantity, 1);
  const system = systemPriceContribution(state.selected!.row as { price?: number; currency?: string }, "EUR", quantity);
  const main = Number(state.eligibleGroups[0].items[0].price);
  assert.equal(system.amount, 377);
  assert.equal(main, 310);
  assert.equal(system.amount + main, 687);
  // the selector looks the System image up with (base_model, its own group id, its own row id)
  assert.equal(productTemplateRowReferenceKey("base_model", state.selected!.group.id, String(state.selected!.row.id)), productTemplateRowReferenceKey("base_model", "comby-system", "M33"));
});

test("an EXISTING saved template that already carries role system_base works immediately after reload (no re-import)", () => {
  const saved = [{ id: "comby-system", pricing_type: "base_model_group", group_name: "COMBY System", is_active: true, sort_order: 0, items: [
    { id: "M33", variant_name: "M33", supplier_price_list_code: "1AJ M33", price: 377, currency: "EUR", role: "system_base", is_active: true, sort_order: 0 },
    { id: "M45", variant_name: "M45", supplier_price_list_code: "1AJ M45", price: 310, currency: "EUR", is_active: true, sort_order: 1 },
  ] }];
  const state = nativeSystemState(activeBaseModelPricingGroups(saved));
  assert.equal(state.selected?.row.id, "M33");
  assert.equal(systemPriceContribution(state.selected!.row as { price?: number; currency?: string }, "EUR", 1).amount + 310, 687);
});

test("templates saved before role persistence (no role in stored JSON) are NOT silently inferred as native", () => {
  const legacySaved = [{ id: "comby-system", pricing_type: "base_model_group", group_name: "COMBY System", is_active: true, sort_order: 0, items: [
    { id: "M33", variant_name: "M33", supplier_price_list_code: "1AJ M33", price: 377, currency: "EUR", is_active: true, sort_order: 0 },
    { id: "M45", variant_name: "M45", price: 310, currency: "EUR", is_active: true, sort_order: 1 },
  ] }];
  const state = nativeSystemState(activeBaseModelPricingGroups(legacySaved));
  assert.equal(state.active, false);
  assert.equal(state.selected, null);
});

test("regression: the editor row serializer keeps role system_base (it was dropped here) and omits it for main rows", () => {
  assert.equal(normalizeBaseModelEditorRow({ id: "s", role: "system_base", price: 1 }, 0).role, "system_base");
  assert.equal("role" in normalizeBaseModelEditorRow({ id: "m", price: 1 }, 0), false);
  assert.equal("role" in normalizeBaseModelEditorRow({ id: "x", role: undefined, price: 1 }, 0), false);
  const editor = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(editor.includes("return normalizeBaseModelEditorRow(row, index);"));
});

test("the Product Library and the quotation action both read groups through the shared loader", () => {
  assert.ok(readFileSync("components/quotations/product-library-selector.tsx", "utf8").includes("activeBaseModelPricingGroups<VariantPricingRow>(template.variant_pricing)"));
  assert.ok(readFileSync("app/quotations/actions.ts", "utf8").includes("activeBaseModelPricingGroups<VariantPricingRow>(template.variant_pricing)"));
});
