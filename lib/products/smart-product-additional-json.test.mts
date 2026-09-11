import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft, ProductTemplateDraftPricedRow } from "./product-template-draft.js";
import { applySmartAdditionalJson, smartAdditionalDuplicateRows, smartAdditionalJsonGroups, type SmartAdditionalGroupDecision } from "./smart-product-additional-json.js";
import { createSmartSetupReviewRouting } from "./smart-product-review-routing.js";
import { deriveSmartProductReviewCurrencyState } from "./smart-product-review.js";
import { baseModelSubgroupsForSmartSetupApply, pendingRowImagesForSmartSetupApply, reviewedRowImageKey } from "./smart-product-row-images.js";

const row = (id: string, code: string, price: number | null, displayName = id): ProductTemplateDraftPricedRow => ({ id, label: displayName, displayName, dimensions: null, currency: "EUR", price, specification: null, supplierCodes: code ? [code] : [], referenceCodes: [] });
const draft = (name: string, rows: ProductTemplateDraftPricedRow[] = []): ProductTemplateDraft => ({ version: 1, template: { templateName: name, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: "EUR", pricing: { workstationRows: [], baseModelRows: rows, priceMatrices: [], modularGroups: [] }, optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 1, sources: [] });
const decision = (action: "add" | "merge" | "skip", targetKey: string | null = null, duplicateChoices: Record<string, "existing" | "incoming"> = {}, destination: SmartAdditionalGroupDecision["destination"] = "base_model"): SmartAdditionalGroupDecision => ({ action, destination, targetKey, duplicateChoices });
const optionGroup = (id: string, label: string, items: ProductTemplateDraftPricedRow[]) => ({ id, label, selection: { mode: "optional" as const, minSelections: 0, maxSelections: null, defaultItemIds: [] }, items });

test("additional JSON opens a logical-group preview with compatible targets", () => {
  const current = draft("Reviewed", [row("a", "1AF 001", 10)]); const incoming = draft("Incoming", [row("b", "1AF 002", 20)]);
  const groups = smartAdditionalJsonGroups(current, createSmartSetupReviewRouting(current), incoming);
  assert.equal(groups.length, 1); assert.equal(groups[0].route.rowCount, 1); assert.equal(groups[0].compatibleTargets[0].key, "base_model:rows");
});

test("identical accessory code sets are exact duplicates and secondary codes are strong identity", () => {
  const current = draft("Current"); const incoming = draft("Incoming");
  current.optionGroups = [optionGroup("coat", "Coat Hanger", [{ ...row("old-1", "3217K", 10, "Coat Hanger 3217K"), supplierCodes: ["X", "3217K"] }, row("old-2", "3283K", 20, "Coat Hanger 3283K")])];
  incoming.optionGroups = [optionGroup("coat-next", "Coat Hanger", [{ ...row("new-1", "3217K", 10, "Coat Hanger 3217K"), supplierCodes: ["X", "3217K"] }, row("new-2", "3283K", 20, "Coat Hanger 3283K")])];
  const group = smartAdditionalJsonGroups(current, createSmartSetupReviewRouting(current), incoming).find((item) => item.route.sourceKind === "option")!;
  assert.equal(group.match.classification, "EXACT_DUPLICATE"); assert.equal(group.match.recommendedAction, "skip"); assert.equal(group.match.bestMatch?.groupName, "Coat Hanger");
});

test("new or commercially changed accessory items recommend merge", () => {
  const current = draft("Current"); const incoming = draft("Incoming");
  current.optionGroups = [optionGroup("arms", "Armrests", [row("703-old", "703", 120), row("760-old", "760", 130)])];
  incoming.optionGroups = [optionGroup("arms-next", "Armrests", [row("703-new", "703", 125), row("760-new", "760", 130), row("770-new", "770", 140)])];
  const group = smartAdditionalJsonGroups(current, createSmartSetupReviewRouting(current), incoming).find((item) => item.route.sourceKind === "option")!;
  assert.equal(group.match.classification, "LIKELY_EXISTING_GROUP"); assert.equal(group.match.recommendedAction, "merge"); assert.equal(group.match.bestMatch?.groupName, "Armrests"); assert.equal(group.match.evidence.newItems, 1); assert.ok(group.match.evidence.differences > 0);
});

test("a single reused code without group-name support is not an exact duplicate", () => {
  const current = draft("Current"); const incoming = draft("Incoming");
  current.optionGroups = [optionGroup("delivery", "Delivery", [row("old", "COMMON", 10)])]; incoming.optionGroups = [optionGroup("hanger", "Coat Hanger", [row("new", "COMMON", 10)])];
  const group = smartAdditionalJsonGroups(current, createSmartSetupReviewRouting(current), incoming).find((item) => item.route.sourceKind === "option")!;
  assert.notEqual(group.match.classification, "EXACT_DUPLICATE");
});

test("matching matrix columns with new rows recommend merge while identical rows skip", () => {
  const current = draft("Current"); const incoming = draft("Incoming");
  current.pricing.priceMatrices = [{ id: "matrix", label: "EVERYis1", columns: [{ id: "sg1", label: "SG1" }], rows: [{ ...row("ev111", "EV111", 100, "EV111"), prices: { sg1: 100 } }] }];
  incoming.pricing.priceMatrices = [{ id: "matrix-next", label: "EVERYis1", columns: [{ id: "sg1", label: "SG1" }], rows: [{ ...row("ev161", "EV161", 100), prices: { sg1: 100 } }] }];
  let group = smartAdditionalJsonGroups(current, createSmartSetupReviewRouting(current), incoming).find((item) => item.route.sourceKind === "matrix")!;
  assert.equal(group.match.classification, "LIKELY_EXISTING_GROUP"); assert.equal(group.match.recommendedAction, "merge");
  incoming.pricing.priceMatrices[0].rows = [{ ...row("other-id", "EV111", 100, "EV111"), prices: { sg1: 100 } }];
  group = smartAdditionalJsonGroups(current, createSmartSetupReviewRouting(current), incoming).find((item) => item.route.sourceKind === "matrix")!;
  assert.equal(group.match.classification, "EXACT_DUPLICATE"); assert.equal(group.match.recommendedAction, "skip");
});

test("skip changes no reviewed fields and add preserves edited template fields", () => {
  const current = draft("User edited", [row("a", "1AF 001", 10)]); current.template.description = "Reviewed description";
  const incoming = draft("AI replacement", [row("b", "1AF 002", 20)]); incoming.template.description = "Incoming description";
  const plan = createSmartSetupReviewRouting(current);
  const skipped = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("skip") });
  assert.deepEqual(skipped.draft, current);
  const added = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("add") });
  assert.equal(added.draft.template.templateName, "User edited"); assert.equal(added.draft.template.description, "Reviewed description"); assert.deepEqual(added.draft.pricing.baseModelRows.map((item) => item.id), ["a", "b"]);
});

test("merge appends non-duplicates and requires an explicit choice to overwrite duplicates", () => {
  const current = draft("Current", [row("existing-id", "1AF 001", 0, "Edited name")]);
  const incoming = draft("Incoming", [row("incoming-id", "1AF 001", null, "Incoming name"), row("new-id", "1AF 002", 20)]);
  const plan = createSmartSetupReviewRouting(current); const incomingRoute = createSmartSetupReviewRouting(incoming).routes[0]; const target = plan.routes[0];
  const conflicts = smartAdditionalDuplicateRows(current, incoming, incomingRoute, target); assert.equal(conflicts.length, 1); assert.ok(conflicts[0].fields.includes("price"));
  const kept = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("merge", "base_model:rows") });
  assert.equal(kept.draft.pricing.baseModelRows[0].price, 0); assert.equal(kept.draft.pricing.baseModelRows[0].displayName, "Edited name"); assert.equal(kept.draft.pricing.baseModelRows[1].id, "new-id");
  const replaced = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("merge", "base_model:rows", { "incoming-id": "incoming" }) });
  assert.equal(replaced.draft.pricing.baseModelRows[0].price, null); assert.equal(replaced.draft.pricing.baseModelRows[0].displayName, "Incoming name"); assert.equal(replaced.draft.pricing.baseModelRows[0].id, "existing-id");
});

test("matrix and accessories-only imports add new independently routed groups", () => {
  const current = draft("Current"); const incoming = draft("Focused");
  incoming.pricing.priceMatrices = [{ id: "foil", label: "3D-Foil", columns: [{ id: "price", label: "Price" }], rows: [{ ...row("foil-1", "1AF 041", 77), prices: { price: 77 } }] }];
  incoming.optionGroups = [{ id: "top", label: "Top Access", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: [] }, items: [row("top-1", "TA 01", 10)] }];
  const decisions = { "matrix:foil": decision("add", null, {}, "base_model"), "option:top": decision("add", null, {}, "accessory") };
  const merged = applySmartAdditionalJson(current, createSmartSetupReviewRouting(current), incoming, decisions);
  assert.equal(merged.draft.pricing.priceMatrices[0].label, "3D-Foil"); assert.equal(merged.draft.optionGroups[0].label, "Top Access");
  assert.equal(merged.plan.routes.find((route) => route.key === "matrix:foil")?.destination, "base_model"); assert.equal(merged.plan.routes.find((route) => route.key === "option:top")?.destination, "accessory");
});

test("manual add destination is retained and repeated additions build one reviewed draft", () => {
  const current = draft("Current"); let plan = createSmartSetupReviewRouting(current); let reviewed = current;
  for (const [id, destination] of [["a", "base_model"], ["b", "skip"], ["c", "base_model"]] as const) {
    const incoming = draft(id, [row(id, id.toUpperCase(), 10)]); const result = applySmartAdditionalJson(reviewed, plan, incoming, { "base_model:rows": decision("add", null, {}, destination) }); reviewed = result.draft; plan = result.plan;
  }
  assert.deepEqual(reviewed.pricing.baseModelRows.map((item) => item.id), ["a", "b", "c"]); assert.equal(plan.routes[0].destination, "base_model");
});

test("materials, sources, and warnings combine conservatively and exact warnings deduplicate", () => {
  const current = draft("Current"); current.materialSuggestions = [{ id: "m1", label: "Leather", notes: "Reviewed", supplierCodes: [], referenceCodes: [] }]; current.extractionWarnings = ["cropped"]; current.sources = [{ id: "s1", documentName: "One", pageNumber: 1, region: null, rawText: null }];
  const incoming = draft("Incoming"); incoming.materialSuggestions = [{ id: "m1", label: "Changed", notes: null, supplierCodes: [], referenceCodes: [] }, { id: "m2", label: "Foil", notes: null, supplierCodes: [], referenceCodes: [] }]; incoming.extractionWarnings = ["cropped", "page missing"]; incoming.sources = [{ id: "s2", documentName: "Two", pageNumber: 2, region: null, rawText: null }];
  const merged = applySmartAdditionalJson(current, createSmartSetupReviewRouting(current), incoming, {});
  assert.deepEqual(merged.draft.materialSuggestions.map((item) => item.label), ["Leather", "Foil"]); assert.deepEqual(merged.draft.extractionWarnings, ["cropped", "page missing"]); assert.deepEqual(merged.draft.sources.map((item) => item.id), ["s1", "s2"]);
});

test("staged images and subgroup membership remain attached while incoming rows start ungrouped", () => {
  const current = draft("Current", [row("a", "A", 10)]); const plan = createSmartSetupReviewRouting(current); const incoming = draft("Incoming", [row("b", "B", 20)]);
  const merged = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("merge", "base_model:rows") });
  const image = { file: "file", previewUrl: "blob:a", sourceKey: "base_model:rows", sourceRowId: "a" };
  assert.equal(pendingRowImagesForSmartSetupApply(merged.draft, merged.plan, { [reviewedRowImageKey("base_model:rows", "a")]: image })[0].rowId, "a");
  const subgroups = baseModelSubgroupsForSmartSetupApply(merged.draft, merged.plan, { "base_model:rows": [{ id: "sg", subgroup_name: "Existing", sort_order: 0, is_active: true, row_ids: ["a"] }] });
  assert.deepEqual(subgroups[0].subgroups[0].row_ids, ["a"]); assert.ok(!subgroups[0].subgroups[0].row_ids.includes("b"));
});

test("additional JSON materializes its own safe default currency before merge", () => {
  const current = draft("Current", [row("eur", "EUR-1", 10)]);
  const incoming = draft("Incoming", [{ ...row("usd", "USD-1", 20), currency: null }]);
  incoming.defaultCurrency = "USD";
  const merged = applySmartAdditionalJson(current, createSmartSetupReviewRouting(current), incoming, {
    "base_model:rows": decision("merge", "base_model:rows"),
  });
  assert.equal(merged.draft.pricing.baseModelRows[1].currency, "USD");
  assert.deepEqual(deriveSmartProductReviewCurrencyState(merged.draft), { kind: "mixed", currency: null, hasUnresolvedPricedRows: false });
});
