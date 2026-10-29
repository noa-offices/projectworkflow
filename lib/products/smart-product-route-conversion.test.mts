import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft.js";
import { mapDraftBaseModelPricing } from "./product-template-draft-base-model-adapter.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { optionItemReviewFingerprint } from "./smart-product-route-conversion.js";
import { createSmartSetupReviewRouting, draftForSmartSetupReviewApply, smartRouteDestinationBlockReason, smartRouteWithDestination, validateSmartSetupReviewRouting, type SmartSetupReviewRoutingPlan } from "./smart-product-review-routing.js";

const load = (): ProductTemplateDraft => {
  const result = normalizeProductTemplateDraft(JSON.parse(readFileSync("lib/products/jera-storage-cabinets.fixture.json", "utf8")));
  assert.ok(result.draft, JSON.stringify(result));
  return result.draft!;
};
const confirmPanel = (draft: ProductTemplateDraft) => { draft.optionGroups[0].items[0].reviewStatus = "confirmed"; return draft; };
const PANEL = "option:jera-vertical-composition-panel";
const CABINETS = "base_model_group:jera-suspended-cabinets";
const route = (plan: SmartSetupReviewRoutingPlan, key: string) => plan.routes.find((item) => item.key === key)!;
const convert = (draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan) => ({ routes: plan.routes.map((item) => item.key === PANEL ? smartRouteWithDestination(draft, item, "base_model") : item.key === CABINETS ? smartRouteWithDestination(draft, item, "accessory") : item) });

test("default routing is unchanged and conversions are not offered globally", () => {
  const draft = load(); const plan = createSmartSetupReviewRouting(draft);
  assert.equal(route(plan, PANEL).destination, "accessory");
  assert.equal(route(plan, CABINETS).destination, "base_model");
  assert.deepEqual(route(plan, PANEL).supportedDestinations, ["accessory", "skip"]);
  assert.deepEqual(route(plan, CABINETS).supportedDestinations, ["base_model", "skip"]);
  assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, true);
});

test("unconfirmed needs_review panel conversion is blocked in the dropdown, validation and direct Apply", () => {
  const draft = load(); const plan = createSmartSetupReviewRouting(draft);
  assert.match(smartRouteDestinationBlockReason(draft, route(plan, PANEL), "base_model") ?? "", /Needs Review/);
  const forced = { routes: plan.routes.map((item) => item.key === PANEL ? { ...item, destination: "base_model" as const } : item) };
  assert.equal(validateSmartSetupReviewRouting(draft, forced).valid, false);
  assert.throws(() => draftForSmartSetupReviewApply(draft, forced), /Needs Review/);
});

test("confirmed panel and cabinets convert with ids, codes, prices and dimensions preserved", () => {
  const draft = confirmPanel(load()); const plan = convert(draft, createSmartSetupReviewRouting(draft));
  assert.equal(smartRouteDestinationBlockReason(draft, route(createSmartSetupReviewRouting(draft), PANEL), "base_model"), null);
  const validation = validateSmartSetupReviewRouting(draft, plan);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  const applied = draftForSmartSetupReviewApply(draft, plan);
  const panelRows = applied.pricing.baseModelRows.filter((row) => row.groupId === "jera-vertical-composition-panel");
  assert.equal(panelRows.length, 1);
  assert.deepEqual([panelRows[0].id, panelRows[0].supplierCodes, panelRows[0].price, panelRows[0].currency], ["jera-159-983", ["159 983"], 702, "EUR"]);
  assert.deepEqual(panelRows[0].dimensions, draft.optionGroups[0].items[0].dimensions);
  assert.equal(panelRows[0].specification, draft.optionGroups[0].items[0].specification);
  assert.equal("reviewReason" in panelRows[0], false);
  assert.equal(applied.pricing.baseModelRows.some((row) => row.groupId === "jera-suspended-cabinets"), false);
  const cabinets = applied.optionGroups.find((group) => group.id === "jera-suspended-cabinets")!;
  assert.deepEqual(cabinets.items.map((item) => [item.id, item.supplierCodes[0], item.price, item.role]), [["jera-159-976", "159 976", 353, undefined], ["jera-159-980", "159 980", 527, undefined]]);
  assert.deepEqual(cabinets.items.map((item) => item.dimensions), draft.pricing.baseModelRows.filter((row) => row.groupId === "jera-suspended-cabinets").map((row) => row.dimensions));
});

test("Product Library mapping: panel is the base model, cabinets are an optional single-selection accessory, companions unchanged", () => {
  const draft = confirmPanel(load()); const plan = convert(draft, createSmartSetupReviewRouting(draft));
  assert.deepEqual(route(plan, CABINETS).accessory, { role: "accessory", selection: "optional_exactly_one", rules: [] });
  const applied = draftForSmartSetupReviewApply(draft, plan);
  const base = mapDraftBaseModelPricing(applied);
  assert.deepEqual(base.groups.map((group) => group.id).sort(), ["jera-low-medium-cabinets", "jera-totem-cabinets", "jera-vertical-composition-panel"]);
  const accessories = mapDraftOptionGroupsToAccessories(applied, plan);
  const groups = accessories.groups;
  const cabinets = groups.find((group) => group.id === "jera-suspended-cabinets")!;
  assert.ok(cabinets, "converted cabinet group reaches Accessory mapping");
  assert.equal(cabinets.group_is_required, false);
  assert.equal(cabinets.conditional_configuration?.selection, "exactly_one");
  assert.deepEqual(cabinets.conditional_configuration?.applicability, []);
  assert.equal(groups.some((group) => group.id === "jera-vertical-composition-panel"), false);
  const baseline = load();
  const baselineGroups = mapDraftOptionGroupsToAccessories(baseline, createSmartSetupReviewRouting(baseline)).groups;
  const sideId = "jera-required-final-side-panel-set";
  const withoutOrder = (group?: object) => ({ ...group, sort_order: undefined }); // only list position shifts when another group is added
  assert.deepEqual(withoutOrder(groups.find((group) => group.id === sideId)), withoutOrder(baselineGroups.find((group) => group.id === sideId)));
});

test("changed panel source invalidates the confirmation", () => {
  const draft = confirmPanel(load()); const plan = convert(draft, createSmartSetupReviewRouting(draft));
  draft.optionGroups[0].items[0].price = 800;
  assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, false);
  assert.throws(() => draftForSmartSetupReviewApply(draft, plan), /changed after the destination was selected/);
});

test("unsupported shapes stay blocked with a reason", () => {
  const reason = (draft: ProductTemplateDraft, key: string, destination: "base_model" | "accessory" | "category_matrix") => smartRouteDestinationBlockReason(draft, route(createSmartSetupReviewRouting(draft), key), destination) ?? "";
  const perCategory = confirmPanel(load()); perCategory.optionGroups[0].items[0].prices = { a: 1 };
  assert.match(reason(perCategory, PANEL, "base_model"), /per-category/);
  const companionRole = confirmPanel(load()); companionRole.optionGroups[0].items[0].role = "companion";
  assert.match(reason(companionRole, PANEL, "base_model"), /companion/);
  const configured = confirmPanel(load());
  assert.match(reason(configured, `option:${configured.optionGroups[2].id}`, "base_model"), /conditional/);
  const system = load(); system.pricing.baseModelRows.find((row) => row.id === "jera-159-976")!.role = "system_base";
  assert.match(reason(system, CABINETS, "accessory"), /System \/ Base/);
  const referenced = load(); referenced.optionGroups[2].conditionalConfiguration!.applicability[0].target = { kind: "base_model", group_id: "jera-suspended-cabinets", row_id: "jera-159-976" };
  assert.match(reason(referenced, CABINETS, "accessory"), /referenced/);
  const collision = confirmPanel(load()); collision.optionGroups[0].id = "jera-suspended-cabinets";
  assert.match(reason(collision, "option:jera-suspended-cabinets", "base_model"), /same group id/);
  assert.match(reason(load(), "base_model_group:jera-totem-cabinets", "category_matrix"), /not supported/);
});

test("confirmation is bound to the acknowledged item state", () => {
  const draft = load(); const item = draft.optionGroups[0].items[0];
  item.reviewStatus = "confirmed"; item.reviewConfirmedFingerprint = optionItemReviewFingerprint(item);
  const plan = route(createSmartSetupReviewRouting(draft), PANEL);
  assert.equal(smartRouteDestinationBlockReason(draft, plan, "base_model"), null);
  item.price = 999;
  assert.match(smartRouteDestinationBlockReason(draft, plan, "base_model") ?? "", /changed after it was confirmed/);
  const forced = { routes: [{ ...plan, destination: "base_model" as const }] };
  assert.equal(validateSmartSetupReviewRouting(draft, forced).valid, false);
  assert.throws(() => draftForSmartSetupReviewApply(draft, forced), /changed after it was confirmed/);
});

test("saved structures: panel base row, cabinet accessory items, combined pricing and unchanged companions", () => {
  const draft = confirmPanel(load()); const plan = convert(draft, createSmartSetupReviewRouting(draft));
  const applied = draftForSmartSetupReviewApply(draft, plan);
  const baseItems = mapDraftBaseModelPricing(applied).groups.find((group) => group.id === "jera-vertical-composition-panel")!.items;
  assert.deepEqual(baseItems.map((item) => [item.id, item.supplier_price_list_code, item.price, item.currency]), [["jera-159-983", "159 983", 702, "EUR"]]);
  const accessoryItems = mapDraftOptionGroupsToAccessories(applied, plan).groups.find((group) => group.id === "jera-suspended-cabinets")!.items;
  assert.deepEqual(accessoryItems.map((item) => [item.id, item.supplier_price_list_code, item.price, item.currency]), [["jera-159-976", "159 976", 353, "EUR"], ["jera-159-980", "159 980", 527, "EUR"]]);
  assert.equal(baseItems[0].price! + accessoryItems[0].price!, 1055, "panel + cabinet");
  assert.equal(baseItems[0].price! + accessoryItems[1].price!, 1229);
  assert.deepEqual(applied.optionGroups.find((group) => group.id === "jera-required-final-side-panel-set"), draft.optionGroups[2]);
  assert.deepEqual(applied.pricing.baseModelRows.filter((row) => row.groupId === "jera-low-medium-cabinets"), draft.pricing.baseModelRows.filter((row) => row.groupId === "jera-low-medium-cabinets"));
});
