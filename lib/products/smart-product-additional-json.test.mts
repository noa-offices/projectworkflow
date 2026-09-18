import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft, ProductTemplateDraftCategoryPricedOptionItem, ProductTemplateDraftPricedRow } from "./product-template-draft.js";
import { applySmartAdditionalJson, compatible, smartAdditionalDuplicateRows, smartAdditionalJsonGroups, type SmartAdditionalGroupDecision } from "./smart-product-additional-json.js";
import { createSmartSetupReviewRouting } from "./smart-product-review-routing.js";
import { deriveSmartProductReviewCurrencyState } from "./smart-product-review.js";
import { baseModelSubgroupsForSmartSetupApply, pendingRowImagesForSmartSetupApply, reviewedRowImageKey } from "./smart-product-row-images.js";

const row = (id: string, code: string, price: number | null, displayName = id): ProductTemplateDraftPricedRow => ({ id, label: displayName, displayName, dimensions: null, currency: "EUR", price, specification: null, supplierCodes: code ? [code] : [], referenceCodes: [] });
const reviewItem = (id: string, code: string, price: number | null, displayName: string, reviewStatus: "confirmed" | "needs_review", reviewReason?: string): ProductTemplateDraftCategoryPricedOptionItem => ({ ...row(id, code, price, displayName), reviewStatus, ...(reviewReason ? { reviewReason } : {}) });
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

test("12: Add More JSON preserves reviewStatus/reviewReason on a brand-new accessory group", () => {
  const current = draft("Current");
  const incoming = draft("Incoming");
  incoming.optionGroups = [optionGroup("access", "Accessories", [reviewItem("item-1", "ART.020", 15, "Electrification", "needs_review", "General collection page only.")])];
  const merged = applySmartAdditionalJson(current, createSmartSetupReviewRouting(current), incoming, { "option:access": decision("add", null, {}, "accessory") });
  const item = merged.draft.optionGroups[0].items[0] as ProductTemplateDraftCategoryPricedOptionItem;
  assert.equal(item.reviewStatus, "needs_review");
  assert.equal(item.reviewReason, "General collection page only.");
});

test("13: duplicate merge cannot silently downgrade needs_review to confirmed when the kept-existing side wins", () => {
  const current = draft("Current");
  current.optionGroups = [optionGroup("access", "Accessories", [reviewItem("existing-1", "ART.010", 25, "Cable Tray", "confirmed")])];
  const incoming = draft("Incoming");
  incoming.optionGroups = [optionGroup("access-next", "Accessories", [reviewItem("incoming-1", "ART.010", 25, "Cable Tray", "needs_review", "Exact target-family applicability is not proven by the supplied source.")])];
  const plan = createSmartSetupReviewRouting(current);
  const merged = applySmartAdditionalJson(current, plan, incoming, { "option:access-next": decision("merge", "option:access") });
  const item = merged.draft.optionGroups[0].items[0] as ProductTemplateDraftCategoryPricedOptionItem;
  assert.equal(item.id, "existing-1", "Expected the kept-existing duplicate to keep its own id (no user override chosen)");
  assert.equal(item.reviewStatus, "needs_review", "Expected needs_review proven by the incoming side to survive even though 'existing' otherwise wins the field merge");
  assert.equal(item.reviewReason, "Exact target-family applicability is not proven by the supplied source.");

  const replaced = applySmartAdditionalJson(current, plan, incoming, { "option:access-next": decision("merge", "option:access", { "incoming-1": "incoming" }) });
  const replacedItem = replaced.draft.optionGroups[0].items[0] as ProductTemplateDraftCategoryPricedOptionItem;
  assert.equal(replacedItem.reviewStatus, "needs_review");
  assert.equal(replacedItem.id, "existing-1", "Expected the existing row's id to be preserved even when its fields are replaced by the incoming row");
});

test("duplicate accessory review metadata survives either commercial-side choice", () => {
  const current = draft("Current");
  current.optionGroups = [optionGroup("access", "Accessories", [reviewItem("existing", "ART.011", 10, "Existing", "needs_review", "Existing uncertainty")])];
  const incoming = draft("Incoming");
  incoming.optionGroups = [optionGroup("access-next", "Accessories", [reviewItem("incoming", "ART.011", 15, "Incoming", "confirmed")])];
  const useIncoming = applySmartAdditionalJson(current, createSmartSetupReviewRouting(current), incoming, { "option:access-next": decision("merge", "option:access", { incoming: "incoming" }) });
  const incomingWinner = useIncoming.draft.optionGroups[0].items[0] as ProductTemplateDraftCategoryPricedOptionItem;
  assert.equal(incomingWinner.price, 15);
  assert.equal(incomingWinner.reviewStatus, "needs_review");
  assert.equal(incomingWinner.reviewReason, "Existing uncertainty");

  current.optionGroups = [optionGroup("access", "Accessories", [reviewItem("existing", "ART.011", 10, "Existing", "confirmed")])];
  incoming.optionGroups = [optionGroup("access-next", "Accessories", [reviewItem("incoming", "ART.011", 15, "Incoming", "needs_review", "Incoming uncertainty")])];
  const keepExisting = applySmartAdditionalJson(current, createSmartSetupReviewRouting(current), incoming, { "option:access-next": decision("merge", "option:access") });
  const existingWinner = keepExisting.draft.optionGroups[0].items[0] as ProductTemplateDraftCategoryPricedOptionItem;
  assert.equal(existingWinner.price, 10);
  assert.equal(existingWinner.reviewStatus, "needs_review");
  assert.equal(existingWinner.reviewReason, "Incoming uncertainty");

  incoming.optionGroups = [optionGroup("access-next", "Accessories", [reviewItem("incoming", "ART.011", 15, "Incoming", "confirmed")])];
  const confirmed = applySmartAdditionalJson(current, createSmartSetupReviewRouting(current), incoming, { "option:access-next": decision("merge", "option:access") });
  assert.equal(confirmed.draft.optionGroups[0].items[0].reviewStatus, "confirmed");
});

// ---------------------------------------------------------------------------
// GLOBAL group-level "+ Import More JSON" (targeted import). The targeted
// constraint itself (only the launch-target route may merge; every other
// incoming route is rejected) is enforced by the caller building a decisions
// map where only the target route's key gets action "merge" and every other
// route gets action "skip" — applySmartAdditionalJson's merge/report logic is
// otherwise unchanged and fully reused. These tests exercise exactly that
// decision shape plus the new addedRowsByTarget report and the reused
// compatible() gate.
// ---------------------------------------------------------------------------

const modularGroup = (id: string, label: string, directRows: ProductTemplateDraftPricedRow[] | null, composition?: { minStarters: number; maxStarters: number | null }) => directRows
  ? { id, label, defaultDimensions: null, defaultSpecification: null, directRows, ...(composition ? { composition } : {}) }
  : { id, label, defaultDimensions: null, defaultSpecification: null, matrix: { id: `${id}-matrix`, label, columns: [{ id: "sg1", label: "SG1" }], rows: [] as { id: string; label: string | null; displayName: string | null; dimensions: null; currency: "EUR"; specification: null; supplierCodes: string[]; referenceCodes: string[]; prices: Record<string, number | null> }[] }, ...(composition ? { composition } : {}) };

test("A1: existing N01-N04 + targeted import N05-N16 results in N01-N16 exactly once", () => {
  const current = draft("Workstation family", [row("n01", "N01", 10), row("n02", "N02", 11), row("n03", "N03", 12), row("n04", "N04", 13)]);
  const incoming = draft("Missing rows", Array.from({ length: 12 }, (_, index) => row(`incoming-n${index + 5}`, `N0${index + 5}`.length === 3 ? `N0${index + 5}` : `N${index + 5}`, 20 + index)));
  const plan = createSmartSetupReviewRouting(current);
  const decisions = { "base_model:rows": decision("merge", "base_model:rows") };
  const merged = applySmartAdditionalJson(current, plan, incoming, decisions);
  const codes = merged.draft.pricing.baseModelRows.flatMap((item) => item.supplierCodes).toSorted();
  assert.deepEqual(codes, ["N01", "N02", "N03", "N04", "N05", "N06", "N07", "N08", "N09", "N10", "N11", "N12", "N13", "N14", "N15", "N16"]);
  assert.equal(new Set(codes).size, codes.length, "Every code must appear exactly once");
  assert.equal(merged.addedRowsByTarget["base_model:rows"]?.length, 12);
});

test("A2: targeted subgroup import reports only the newly added row ids for subgroup assignment", () => {
  const current = draft("Family", [row("n01", "N01", 10)]);
  const incoming = draft("More", [row("incoming-n02", "N02", 11), row("incoming-n03", "N03", 12)]);
  const plan = createSmartSetupReviewRouting(current);
  const merged = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("merge", "base_model:rows") });
  const newRowIds = merged.addedRowsByTarget["base_model:rows"] ?? [];
  assert.equal(newRowIds.length, 2);
  assert.ok(!newRowIds.includes("n01"), "The pre-existing row must never be reported as newly added");
  const existingSubgroup = { id: "sg-1", subgroup_name: "N Family", sort_order: 0, is_active: true, row_ids: ["n01"] };
  const nextRowIds = [...new Set([...existingSubgroup.row_ids, ...newRowIds])];
  assert.deepEqual(nextRowIds, ["n01", "incoming-n02", "incoming-n03"]);
});

test("A3: importing into Base/Model main without a subgroup leaves new rows ungrouped", () => {
  const current = draft("Family", [row("n01", "N01", 10)]);
  const incoming = draft("More", [row("incoming-n02", "N02", 11)]);
  const plan = createSmartSetupReviewRouting(current);
  const merged = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("merge", "base_model:rows") });
  const subgroups = baseModelSubgroupsForSmartSetupApply(merged.draft, merged.plan, { "base_model:rows": [{ id: "sg", subgroup_name: "Existing", sort_order: 0, is_active: true, row_ids: ["n01"] }] });
  assert.ok(!subgroups[0].subgroups[0].row_ids.includes("incoming-n02"), "A new row must never land in a subgroup unless explicitly assigned");
});

test("B4/B5/B6: targeted merge skips exact duplicates, flags conflicts, and only overwrites on explicit Use Incoming", () => {
  const current = draft("Family", [row("n01", "N01", 10, "N01 Desk")]);
  const incoming = draft("More", [row("incoming-dup", "N01", 10, "N01 Desk"), row("incoming-conflict-src", "N02", 999, "N02 Desk"), row("incoming-new", "N03", 30, "N03 Desk")]);
  current.pricing.baseModelRows.push(row("n02", "N02", 15, "N02 Desk"));
  const plan = createSmartSetupReviewRouting(current);
  const kept = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("merge", "base_model:rows") });
  assert.equal(kept.draft.pricing.baseModelRows.length, 3, "Exact duplicate must be skipped, not duplicated");
  assert.equal(kept.draft.pricing.baseModelRows.find((item) => item.id === "n02")?.price, 15, "Conflicting price must never be silently overwritten");
  assert.deepEqual(kept.addedRowsByTarget["base_model:rows"]?.toSorted(), ["incoming-new"], "Only the genuinely new row is reported as added");
  const replaced = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("merge", "base_model:rows", { "incoming-conflict-src": "incoming" }) });
  assert.equal(replaced.draft.pricing.baseModelRows.find((item) => item.id === "n02")?.price, 999, "Price changes only after the user explicitly chooses Use Incoming");
});

test("C7/C8/C9: targeted accessory import appends items, keeps needs_review sticky, and never rewrites group-level conditionalConfiguration", () => {
  const current = draft("Current");
  current.optionGroups = [{ ...optionGroup("access", "Accessories", [row("existing-1", "ART.001", 10, "Bracket")]), conditionalConfiguration: { role: "companion", selection: "at_least_one", applicability: [{ base_model_group_id: "legacy-base-model-main", base_model_row_id: "n01", required: true, visible: true }] } }];
  const incoming = draft("Incoming");
  incoming.optionGroups = [optionGroup("access-next", "Accessories", [reviewItem("incoming-new", "ART.002", 15, "Cover Plate", "needs_review", "Applicability not confirmed by source.")])];
  const plan = createSmartSetupReviewRouting(current);
  const merged = applySmartAdditionalJson(current, plan, incoming, { "option:access-next": decision("merge", "option:access") });
  assert.equal(merged.draft.optionGroups[0].items.length, 2);
  const added = merged.draft.optionGroups[0].items.find((item) => item.supplierCodes.includes("ART.002")) as ProductTemplateDraftCategoryPricedOptionItem;
  assert.equal(added.reviewStatus, "needs_review");
  assert.equal(added.reviewReason, "Applicability not confirmed by source.");
  assert.deepEqual(merged.draft.optionGroups[0].conditionalConfiguration, current.optionGroups[0].conditionalConfiguration);
  assert.deepEqual(merged.addedRowsByTarget["option:access"], [added.id]);
});

test("D10/D12/D13: targeted Direct Modular row append preserves pricing mode and composition", () => {
  const current = draft("Current");
  current.pricing.modularGroups = [modularGroup("dm", "Direct Modular Group", [row("starter-1", "DM-S1", 100)], { minStarters: 1, maxStarters: 2 })];
  const incoming = draft("Incoming");
  incoming.pricing.modularGroups = [modularGroup("dm-next", "Direct Modular Group", [row("intermediate-1", "DM-I1", 50)])];
  const plan = createSmartSetupReviewRouting(current);
  const merged = applySmartAdditionalJson(current, plan, incoming, { "modular:dm-next": decision("merge", "modular:dm") });
  const group = merged.draft.pricing.modularGroups[0];
  assert.equal(group.directRows?.length, 2);
  assert.ok(!group.matrix, "Direct Modular group must not gain a matrix after a targeted row-completion merge");
  assert.deepEqual(group.composition, { minStarters: 1, maxStarters: 2 }, "Composition metadata must be preserved, not overwritten");
  assert.deepEqual(merged.addedRowsByTarget["modular:dm"], ["intermediate-1"]);
});

test("D11/D12/D13: targeted Matrix Modular row append preserves matrix mode, columns, and composition", () => {
  const current = draft("Current");
  current.pricing.modularGroups = [{ id: "mm", label: "Matrix Modular Group", defaultDimensions: null, defaultSpecification: null, composition: { minStarters: 1, maxStarters: null }, matrix: { id: "mm-matrix", label: "Matrix Modular Group", columns: [{ id: "sg1", label: "SG1" }], rows: [{ ...row("mm-1", "MM-1", null), prices: { sg1: 200 } }] } }];
  const incoming = draft("Incoming");
  incoming.pricing.modularGroups = [{ id: "mm-next", label: "Matrix Modular Group", defaultDimensions: null, defaultSpecification: null, matrix: { id: "mm-next-matrix", label: "Matrix Modular Group", columns: [{ id: "sg1", label: "SG1" }], rows: [{ ...row("mm-2", "MM-2", null), prices: { sg1: 250 } }] } }];
  const plan = createSmartSetupReviewRouting(current);
  const merged = applySmartAdditionalJson(current, plan, incoming, { "modular:mm-next": decision("merge", "modular:mm") });
  const group = merged.draft.pricing.modularGroups[0];
  assert.equal(group.matrix?.rows.length, 2);
  assert.ok(!group.directRows, "Matrix Modular group must not gain directRows after a targeted row-completion merge");
  assert.deepEqual(group.matrix?.columns, [{ id: "sg1", label: "SG1" }], "Category columns must be untouched");
  assert.deepEqual(group.composition, { minStarters: 1, maxStarters: null });
  assert.deepEqual(merged.addedRowsByTarget["modular:mm"], ["mm-2"]);
});

test("E14-E17: compatible() rejects every cross-kind pairing so wrong-target imports never silently land elsewhere", () => {
  const current = draft("Current", [row("n01", "N01", 10)]);
  current.optionGroups = [optionGroup("access", "Accessories", [row("acc-1", "ART.001", 10)])];
  current.pricing.modularGroups = [modularGroup("direct-mod", "Direct Modular", [row("dm-1", "DM-1", 10)])];
  const plan = createSmartSetupReviewRouting(current);
  const baseModelTarget = plan.routes.find((route) => route.key === "base_model:rows")!;
  const accessoryTarget = plan.routes.find((route) => route.key === "option:access")!;
  const directModularTarget = plan.routes.find((route) => route.key === "modular:direct-mod")!;

  const incomingAccessory = draft("Incoming accessory"); incomingAccessory.optionGroups = [optionGroup("acc2", "More Access", [row("acc-2", "ART.002", 5)])];
  const incomingAccessoryRoute = createSmartSetupReviewRouting(incomingAccessory).routes[0];
  assert.equal(compatible(current, incomingAccessory, baseModelTarget, incomingAccessoryRoute), false, "14: accessory JSON must be rejected against a Base/Model target");

  const incomingBaseModel = draft("Incoming base model", [row("n99", "N99", 10)]);
  const incomingBaseModelRoute = createSmartSetupReviewRouting(incomingBaseModel).routes[0];
  assert.equal(compatible(current, incomingBaseModel, accessoryTarget, incomingBaseModelRoute), false, "15: Base/Model JSON must be rejected against an accessory target");

  const incomingMatrixModular = draft("Incoming matrix modular");
  incomingMatrixModular.pricing.modularGroups = [{ id: "mm2", label: "Matrix Modular", defaultDimensions: null, defaultSpecification: null, matrix: { id: "mm2-matrix", label: "Matrix Modular", columns: [{ id: "sg1", label: "SG1" }], rows: [] } }];
  const incomingMatrixModularRoute = createSmartSetupReviewRouting(incomingMatrixModular).routes[0];
  assert.equal(compatible(current, incomingMatrixModular, directModularTarget, incomingMatrixModularRoute), false, "16: a Matrix Modular route (different column shape/mode) must be rejected against a Direct Modular target");

  assert.equal(compatible(current, current, baseModelTarget, accessoryTarget), false, "17: unrelated sourceKinds are never treated as compatible");
});

test("F18-F20: a targeted-style decisions map (only the launch target merges) never mutates unrelated routes, and top-level (untargeted) behavior is unaffected", () => {
  const current = draft("Current", [row("n01", "N01", 10)]);
  current.optionGroups = [optionGroup("access", "Accessories", [row("acc-1", "ART.001", 10)])];
  const incoming = draft("Incoming", [row("incoming-n02", "N02", 11)]);
  incoming.optionGroups = [optionGroup("access-incoming", "Accessories", [row("incoming-acc", "ART.999", 99)])];
  incoming.sources = [{ id: "s1", documentName: "New", pageNumber: 5, region: null, rawText: null }];
  const plan = createSmartSetupReviewRouting(current);
  // Simulates exactly what the "+ Import More JSON" targeted dialog produces: only the launch
  // target's route key gets "merge"; every other incoming route is "skip" (rejected).
  const merged = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("merge", "base_model:rows"), "option:access-incoming": decision("skip") });
  assert.deepEqual(merged.draft.optionGroups[0].items.map((item) => item.id), ["acc-1"], "The untargeted accessory route must remain completely unchanged");
  assert.equal(merged.draft.pricing.baseModelRows.length, 2);
  assert.deepEqual(merged.draft.sources.map((item) => item.id), ["s1"], "Supplemental sources still merge exactly as top-level Add More JSON already does");
  assert.deepEqual(Object.keys(merged.addedRowsByTarget), ["base_model:rows"], "Only the targeted route reports newly added rows");
});
