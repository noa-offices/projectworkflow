import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateProductAccessorySelection } from "./product-accessory-configuration.js";
import {
  currentSystemPricing,
  isSystemBaseRow,
  mainProductRows,
  nativeBaseModelTargets,
  nativeSystemState,
  normalizeSystemQuantity,
  remapBaseModelTargetsToOwnerGroups,
  strictSystemQuantity,
  systemPriceContribution,
  systemPricingQuantity,
  systemPricingSnapshot,
  systemSelectedOptionSnapshot,
} from "./native-system-base.js";
import { collectSupplierCodeSummary } from "./derived-document-data.js";

const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
const actions = readFileSync("app/quotations/actions.ts", "utf8");

type Row = { id: string; role?: "system_base"; variant_name?: string; supplier_price_list_code?: string; dimension?: string; price?: number; currency?: string };
const group = (id: string, items: Row[]) => ({ id, group_name: `Group ${id}`, items });
const system: Row = { id: "sys", role: "system_base", variant_name: "Structure", supplier_price_list_code: "SYS-1", dimension: "W80", price: 377, currency: "EUR" };
const main: Row = { id: "m1", variant_name: "Main", price: 310, currency: "EUR" };
const native = group("g", [system, main]);

// ---- display ----
test("1-3: the System row keeps its supplier code, is found by reference key, and never appears among Main models", () => {
  const state = nativeSystemState([native], "sys");
  assert.equal(state.selected?.row.supplier_price_list_code, "SYS-1");
  assert.equal(state.selected?.group.id, "g");
  // reference lookup key is the same (pricingType, groupId, rowId) used for ordinary rows: nothing filters system rows out
  assert.ok(selector.includes('productTemplateRowReferenceKey("base_model", nativeSystem.selected.group.id, systemRow.id ?? "")'));
  assert.deepEqual(mainProductRows(native.items).map((row) => row.id), ["m1"]);
  assert.equal(isSystemBaseRow(system), true);
  assert.ok(selector.includes('label="Supplier Code" value={systemRow.supplier_price_list_code}'));
});

// ---- quantity ----
test("4-8: default 1, manual 2 accepted, 0/negative/non-integer normalized safely, strict server parse rejects them", () => {
  assert.equal(normalizeSystemQuantity(undefined), 1);
  assert.equal(normalizeSystemQuantity(""), 1);
  assert.equal(normalizeSystemQuantity(2), 2);
  assert.equal(normalizeSystemQuantity("2"), 2);
  assert.equal(normalizeSystemQuantity(0), 1);
  assert.equal(normalizeSystemQuantity(-3), 1);
  assert.equal(normalizeSystemQuantity(2.9), 2);
  assert.equal(normalizeSystemQuantity("abc"), 1);
  assert.equal(strictSystemQuantity(""), 1);
  assert.equal(strictSystemQuantity("2"), 2);
  assert.equal(strictSystemQuantity("0"), null);
  assert.equal(strictSystemQuantity("1.5"), null);
  assert.equal(strictSystemQuantity("-1"), null);
  assert.equal(strictSystemQuantity("x"), null);
  // changing System resets quantity state (client) and the server never trusts the client price
  assert.ok(selector.includes("setSelectedSystemQuantities((current) => { const next = { ...current }; delete next[template.id]; return next; });"));
  assert.ok(actions.includes("strictSystemQuantity(textValue(formData, \"system_base_quantity\"))"));
});

// ---- price ----
test("9-10: 377 x 1 + 310 = 687 and 377 x 2 + 310 = 1064", () => {
  assert.equal(systemPriceContribution(system, "EUR", 1).amount + main.price!, 687);
  assert.equal(systemPriceContribution(system, "EUR", 2).amount + main.price!, 1064);
});

test("11-13: accessories add after System + Main; the System appears once; currency totals carry the multiplied amount", () => {
  const contribution = systemPriceContribution(system, "EUR", 2);
  const accessories = 25;
  assert.equal(contribution.matching + main.price! + accessories, 1089);
  const totals = new Map<string, number>();
  const add = (currency: string, amount: number) => totals.set(currency, (totals.get(currency) ?? 0) + amount);
  add("EUR", main.price!); add(contribution.currency, contribution.amount); add("EUR", accessories);
  assert.equal(totals.get("EUR"), 1089);
  assert.equal(systemPriceContribution(system, "AED", 2).matching, 0, "another currency never joins the same-currency sum");
  assert.equal(systemPriceContribution(system, "AED", 2).amount, 754);
});

test("14: the server multiplies by the validated quantity exactly as the client contribution does", () => {
  assert.ok(actions.includes("money(calculationNumber(nativeSystemOption.row.price) * systemQuantity)"));
  assert.ok(selector.includes("systemPriceContribution(nativeSystem.selected?.row, normalizeCurrency(rowCurrency), systemQuantity)"));
  assert.equal(systemPriceContribution(system, "EUR", 2).amount, 377 * 2);
});

// ---- selected items ----
test("15-17: Selected Items lists the System separately, with supplier code and quantity", () => {
  assert.ok(selector.includes('<p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">System / Base</p>'));
  assert.ok(selector.includes("systemContribution.unitPrice)} x {systemQuantity}"));
  assert.ok(selector.includes("Supplier Code: {nativeSystem.selected.row.supplier_price_list_code}"));
  assert.ok(selector.includes("templateSelectionName(template)"), "the Main item card is still its own card");
});

// ---- snapshot ----
test("18-20: system_pricing carries quantity, old snapshots default to 1, and repricing multiplies", () => {
  assert.equal(systemPricingSnapshot("g", system, 2).quantity, 2);
  assert.equal(systemSelectedOptionSnapshot("g", system, 2).quantity, 2);
  const legacy = { system_pricing: { group_id: "g", row: { id: "sys" } } };
  assert.equal(systemPricingQuantity(legacy), 1);
  assert.equal(systemPricingQuantity({ variant_pricing: { id: "m1" } }), 1);
  const rows = [{ id: "sys", price: 400, currency: "EUR" }];
  const saved = { system_pricing: { group_id: "g", quantity: 3, row: { id: "sys" } } };
  const priced = currentSystemPricing(saved, rows);
  assert.deepEqual(priced, { kind: "ok", price: 400, quantity: 3, total: 1200, currency: "EUR" });
  const old = currentSystemPricing(legacy, rows);
  assert.equal(old.kind === "ok" ? old.total : null, 400);
  assert.equal(currentSystemPricing({ variant_pricing: { id: "m1" } }, rows).kind, "none");
});

test("snapshot supplier code stays available to derived document data with a quantity present", () => {
  const entries = collectSupplierCodeSummary({ system_pricing: systemPricingSnapshot("g", system, 2), selected_options: [systemSelectedOptionSnapshot("g", system, 2)] });
  assert.deepEqual(entries.map((entry) => entry.code), ["SYS-1"]);
});

// ---- accessories ----
const conditional = (id: string, role: string, rules: Array<{ group_id: string; row_id: string }>) => ({
  id, group_name: id, group_is_required: false, items: [{ id: `${id}-i`, price: 10 }],
  conditional_configuration: { role, selection: "exactly_one", applicability: rules.map((target) => ({ target: { kind: "base_model", ...target }, required: role === "companion", visible: true })) },
});
const evaluate = (groups: unknown[], targets: ReturnType<typeof nativeBaseModelTargets>) => evaluateProductAccessorySelection({ accessoryGroups: groups as never, selectedModelTargets: targets, selectedQuantities: {} });
const both = nativeBaseModelTargets({ mainGroupId: "g", mainRowId: "m1", systemGroupId: "g", systemRowId: "sys" });

test("21-24: an unrestricted optional group, System-targeted and Main-targeted companions all render and coexist", () => {
  const plain = { id: "plain", group_name: "Plain", group_is_required: false, items: [{ id: "p1", price: 5 }] };
  const optionalUnrestricted = { id: "opt", group_name: "Opt", group_is_required: false, items: [{ id: "o1", price: 5 }], conditional_configuration: { role: "accessory", selection: "choose_multiple", applicability: [] } };
  const forSystem = conditional("sysComp", "companion", [{ group_id: "g", row_id: "sys" }]);
  const forMain = conditional("mainComp", "companion", [{ group_id: "g", row_id: "m1" }]);
  const result = evaluate([plain, optionalUnrestricted, forSystem, forMain], both);
  assert.deepEqual(result.groups.map((entry) => [entry.groupId, entry.visible]), [["plain", true], ["opt", true], ["sysComp", true], ["mainComp", true]]);
});

test("stale legacy Base/Model rule targets are re-pointed to the native group that owns the row (otherwise the group stays hidden)", () => {
  const stale = conditional("kit", "conditional_option", [{ group_id: "legacy-base-model-main", row_id: "m1" }, { group_id: "legacy-base-model-main", row_id: "sys" }]);
  assert.equal(evaluate([stale], both).groups[0].visible, false, "without the remap the rule never matches native ids");
  const remapped = remapBaseModelTargetsToOwnerGroups([stale], [native]);
  assert.deepEqual(remapped[0].conditional_configuration?.applicability.map((rule) => rule.target?.group_id), ["g", "g"]);
  assert.equal(evaluate(remapped, both).groups[0].visible, true);
  // correct targets and groups without configuration keep their identity
  const fine = conditional("ok", "companion", [{ group_id: "g", row_id: "m1" }]);
  const plain = { id: "plain", group_name: "Plain", items: [], conditional_configuration: undefined };
  const same = remapBaseModelTargetsToOwnerGroups([fine, plain], [native]);
  assert.equal(same[0], fine);
  assert.equal(same[1], plain);
  assert.ok(selector.includes("remapBaseModelTargetsToOwnerGroups(activeAccessoryRows(template.accessory_pricing), variantGroups)"));
  assert.ok(actions.includes("remapBaseModelTargetsToOwnerGroups(activeAccessoryRows(template.accessory_pricing), activeBaseModelGroups)"));
});

test("25: structural_support option-item behavior is untouched (option_item targets are not remapped)", () => {
  const support = { id: "sup", group_name: "Sup", items: [{ id: "s1", role: "structural_support" }], conditional_configuration: { role: "companion", selection: "exactly_one", applicability: [{ target: { kind: "option_item", group_id: "sup", row_id: "s1" }, required: true, visible: true }] } };
  assert.equal(remapBaseModelTargetsToOwnerGroups([support], [native])[0], support);
});

// ---- regression ----
test("26-30: templates without system_base rows are unchanged (no System state, no quantity effect, same groups)", () => {
  const ordinary = [group("plain", [main])];
  const state = nativeSystemState(ordinary);
  assert.equal(state.active, false);
  assert.equal(state.eligibleGroups, ordinary);
  assert.equal(systemPriceContribution(null, "EUR", 5).amount, 0);
  assert.equal(nativeBaseModelTargets({ mainGroupId: "plain", mainRowId: "m1" }).length, 1);
  assert.ok(selector.includes("variantGroups.some((group) => group.items.some(isSystemBaseRow)) ? remapBaseModelTargetsToOwnerGroups"), "remap only runs for native templates");
  assert.ok(actions.includes("nativeSystemState(activeBaseModelGroups).active"));
  assert.equal(systemPricingQuantity({ variant_pricing: { id: "m1" } }), 1);
});

test("System quantity is not an accessory quantity: the evaluator receives no System quantity for base_model targets", () => {
  // no scale_with_target_quantity on base_model rules; selectedModelTargetQuantities is only fed by modular/option_item flows
  const evaluatorStart = selector.indexOf("selectedModelTargetQuantities: Object.fromEntries([");
  assert.ok(evaluatorStart > 0);
  assert.equal(selector.slice(evaluatorStart, evaluatorStart + 700).includes("systemQuantity"), false);
  const withQuantity = evaluateProductAccessorySelection({ accessoryGroups: [conditional("c", "companion", [{ group_id: "g", row_id: "sys" }])] as never, selectedModelTargets: both, selectedModelTargetQuantities: { "base_model\u0000g\u0000sys": 5 }, selectedQuantities: {} });
  const without = evaluate([conditional("c", "companion", [{ group_id: "g", row_id: "sys" }])], both);
  assert.deepEqual(withQuantity.groups.map((entry) => entry.fixedQuantity), without.groups.map((entry) => entry.fixedQuantity));
});
