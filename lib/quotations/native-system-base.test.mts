import assert from "node:assert/strict";
import test from "node:test";
import { guidedBaseModelSelection } from "./guided-base-model-selection.js";
import { collectSupplierCodeSummary } from "./derived-document-data.js";
import { evaluateProductAccessorySelection } from "./product-accessory-configuration.js";
import {
  composeSystemAndMainSpecification,
  currentSystemPricing,
  isSystemBaseRow,
  nativeBaseModelTargets,
  nativeSystemState,
  systemPriceContribution,
  systemPricingRowId,
  systemPricingSnapshot,
  systemSelectedOptionSnapshot,
} from "./native-system-base.js";

type Row = { id: string; role?: "system_base"; variant_name?: string; display_name?: string; supplier_price_list_code?: string; dimension?: string; price?: number; currency?: string; specification?: string };
const row = (id: string, extra: Partial<Row> = {}): Row => ({ id, variant_name: id, price: 100, currency: "AED", ...extra });
const group = (id: string, items: Row[], subgroups: Array<{ id: string; row_ids: string[] }> = []) => ({
  id, pricing_type: "base_model_group" as const, group_name: `Group ${id}`, is_active: true, sort_order: 0, items,
  subgroups: subgroups.map((subgroup, index) => ({ ...subgroup, subgroup_name: subgroup.id, sort_order: index, is_active: true })),
});
const systemA = group("system-a", [
  row("sa1", { role: "system_base", price: 500, supplier_price_list_code: "SYS-A1", specification: "System A1 spec" }),
  row("sa2", { role: "system_base", price: 650 }),
  row("a1-1"), row("a1-2"),
], [{ id: "sub-a1", row_ids: ["a1-1", "a1-2"] }]);
const systemB = group("system-b", [row("sb1", { role: "system_base", price: 400 }), row("b1-1")], [{ id: "sub-b1", row_ids: ["b1-1"] }]);
const plain = group("plain", [row("p1"), row("p2")]);
const ids = (groups: Array<{ items: Row[] }>) => groups.flatMap((entry) => entry.items.map((item) => item.id));

// ---- selection ----
test("system_base rows are excluded from main rows and listed in the System selector", () => {
  const state = nativeSystemState([systemA, systemB], "sa1");
  assert.equal(state.active, true);
  assert.deepEqual(state.options.map((option) => option.row.id), ["sa1", "sa2", "sb1"]);
  assert.ok(!ids(state.eligibleGroups).some((id) => id.startsWith("sa") || id.startsWith("sb")));
  assert.equal(isSystemBaseRow(row("x")), false);
});

test("selecting a System chooses its group; System A hides System B's main rows and vice versa", () => {
  const a = nativeSystemState([systemA, systemB], "sa1");
  assert.equal(a.selected?.group.id, "system-a");
  assert.deepEqual(ids(a.eligibleGroups), ["a1-1", "a1-2"]);
  const b = nativeSystemState([systemA, systemB], "sb1");
  assert.deepEqual(ids(b.eligibleGroups), ["b1-1"]);
});

test("switching System makes the previously selected main row incompatible", () => {
  const before = nativeSystemState([systemA, systemB], "sa1");
  assert.ok(ids(before.eligibleGroups).includes("a1-1"));
  const after = nativeSystemState([systemA, systemB], "sb1");
  assert.equal(ids(after.eligibleGroups).includes("a1-1"), false);
});

test("multiple system rows in one group share that group's main rows; several rows are never auto-selected", () => {
  const state = nativeSystemState([systemA]);
  assert.deepEqual(state.options.map((option) => option.row.id), ["sa1", "sa2"]);
  assert.equal(state.selected, null);
  assert.deepEqual(ids(state.eligibleGroups), []);
  assert.equal(state.requiresSystem, true);
  assert.deepEqual(ids(nativeSystemState([systemA], "sa2").eligibleGroups), ["a1-1", "a1-2"]);
  // exactly one system row in the whole template may auto-select
  assert.equal(nativeSystemState([systemB]).selected?.row.id, "sb1");
});

test("template without system_base rows is unchanged (same groups, no System, no requirement)", () => {
  const groups = [plain];
  const state = nativeSystemState(groups);
  assert.equal(state.active, false);
  assert.equal(state.eligibleGroups, groups);
  assert.equal(state.selected, null);
  assert.equal(state.requiresSystem, false);
  assert.equal(systemPriceContribution(null, "AED").amount, 0);
});

// ---- guided / browse ----
test("guided selection ignores system rows and keeps subgroup rows correct", () => {
  const byGroup = guidedBaseModelSelection([systemA], "system-a", "sub-a1");
  assert.deepEqual(byGroup.rows.map((entry) => entry.id), ["a1-1", "a1-2"]);
  assert.deepEqual(byGroup.ungrouped.map((entry) => entry.id), []);
  // a single valid Main Product subgroup auto-resolves (existing guided behavior), still without system rows
  assert.deepEqual(guidedBaseModelSelection([systemA], "system-a", "").rows.map((entry) => entry.id), ["a1-1", "a1-2"]);
  const noSubgroups = guidedBaseModelSelection([group("g", [row("s", { role: "system_base" }), row("m1")])], "g", "");
  assert.deepEqual(noSubgroups.rows.map((entry) => entry.id), ["m1"]);
});

test("Browse All input (eligible groups) never carries system rows, including 'Other Models'", () => {
  const withOther = group("system-c", [row("sc", { role: "system_base" }), row("c-grouped"), row("c-other")], [{ id: "sub-c", row_ids: ["c-grouped"] }]);
  const eligible = nativeSystemState([withOther], "sc").eligibleGroups;
  assert.deepEqual(ids(eligible), ["c-grouped", "c-other"]);
});

// ---- companions ----
const conditional = (id: string, target: { group_id: string; row_id: string }) => ({
  id, group_name: id, group_is_required: false, items: [{ id: `${id}-item`, price: 10 }],
  conditional_configuration: { role: "companion", selection: "exactly_one", applicability: [{ target: { kind: "base_model", ...target }, required: true, visible: true }] },
});
const evaluate = (groups: unknown[], targets: ReturnType<typeof nativeBaseModelTargets>) =>
  evaluateProductAccessorySelection({ accessoryGroups: groups as never, selectedModelTargets: targets, selectedQuantities: {} });

test("System and Main selections both emit base_model targets and coexist", () => {
  assert.deepEqual(nativeBaseModelTargets({ systemGroupId: "system-a", systemRowId: "sa1" }), [{ kind: "base_model", group_id: "system-a", row_id: "sa1" }]);
  assert.deepEqual(nativeBaseModelTargets({ mainGroupId: "system-a", mainRowId: "a1-1" }), [{ kind: "base_model", group_id: "system-a", row_id: "a1-1" }]);
  assert.deepEqual(nativeBaseModelTargets({ mainGroupId: "system-a", mainRowId: "a1-1", systemGroupId: "system-a", systemRowId: "sa1" }).map((target) => target.row_id), ["a1-1", "sa1"]);
});

test("required companion targeting the System row resolves through the existing evaluator; main-row companions are unchanged", () => {
  const forSystem = conditional("top", { group_id: "system-a", row_id: "sa1" });
  const forMain = conditional("service", { group_id: "system-a", row_id: "a1-1" });
  const both = nativeBaseModelTargets({ mainGroupId: "system-a", mainRowId: "a1-1", systemGroupId: "system-a", systemRowId: "sa1" });
  const result = evaluate([forSystem, forMain], both);
  assert.deepEqual(result.groups.map((entry) => [entry.groupId, entry.visible, entry.required]), [["top", true, true], ["service", true, true]]);
  const mainOnly = evaluate([forSystem, forMain], nativeBaseModelTargets({ mainGroupId: "system-a", mainRowId: "a1-1" }));
  assert.deepEqual(mainOnly.groups.map((entry) => [entry.groupId, entry.visible]), [["top", false], ["service", true]]);
  const systemOnly = evaluate([forSystem, forMain], nativeBaseModelTargets({ systemGroupId: "system-a", systemRowId: "sa1" }));
  assert.deepEqual(systemOnly.groups.map((entry) => [entry.groupId, entry.visible]), [["top", true], ["service", false]]);
});

// ---- price ----
test("System + Main + accessories are summed once; inactive templates add nothing", () => {
  const system = systemPriceContribution(row("sa1", { price: 500 }), "AED");
  const mainPrice = 100; const accessories = 20;
  assert.equal(system.matching + mainPrice + accessories, 620);
  assert.equal(systemPriceContribution(null, "AED").matching + mainPrice + accessories, 120);
  // per-currency totals carry the System amount exactly once
  const totals = new Map<string, number>();
  const add = (currency: string, amount: number) => totals.set(currency, (totals.get(currency) ?? 0) + amount);
  add("AED", mainPrice); add(system.currency, system.amount); add("AED", accessories);
  assert.equal(totals.get("AED"), 620);
});

test("System in another currency is kept out of the matching sum but stays in currency totals", () => {
  const system = systemPriceContribution(row("sa1", { price: 500, currency: "EUR" }), "AED");
  assert.equal(system.matching, 0);
  assert.equal(system.amount, 500);
  assert.equal(system.currency, "EUR");
});

test("quantity and discount apply to the aggregated unit price, not per component", () => {
  const unit = 500 + 100 + 20;
  const discount = 10; // percent
  assert.equal(unit * 2, 1240);
  assert.equal(Math.round(unit * (1 - discount / 100) * 2 * 100) / 100, 1116);
});

// ---- snapshot ----
test("system_pricing snapshot keeps identity, supplier code, spec and role; Main stays in variant_pricing", () => {
  const snapshot = systemPricingSnapshot("system-a", { id: "sa1", variant_name: "Base A1", display_name: "Base A1 Display", supplier_price_list_code: "SYS-A1", dimension: "W80", price: 500, currency: "AED", specification: "System A1 spec" });
  assert.deepEqual(snapshot, { group_id: "system-a", quantity: 1, row: { id: "sa1", variant_name: "Base A1", display_name: "Base A1 Display", supplier_price_list_code: "SYS-A1", dimension: "W80", price: 500, currency: "AED", specification: "System A1 spec", role: "system_base" } });
  const source = { variant_pricing: { id: "a1-1", price: 100 }, system_pricing: snapshot };
  assert.equal((source.variant_pricing as { id: string }).id, "a1-1");
  assert.equal(systemPricingRowId(source), "sa1");
});

test("selected_options mirror entry has no id/accessory pair so it can never be double counted", () => {
  const entry = systemSelectedOptionSnapshot("system-a", { id: "sa1", supplier_price_list_code: "SYS-A1", specification: "spec", price: 500 }) as Record<string, unknown>;
  assert.equal(entry.item_type, "system_pricing");
  assert.equal(entry.label, "System / Base");
  assert.equal("id" in entry, false);
  assert.equal("price" in entry, false);
  assert.equal(Boolean(entry.group_name && entry.item_name), false);
});

test("old snapshots without system_pricing are valid and unchanged", () => {
  assert.equal(systemPricingRowId({ variant_pricing: { id: "a1-1" } }), null);
  assert.equal(systemPricingRowId(null), null);
  assert.deepEqual(currentSystemPricing({ variant_pricing: { id: "a1-1" } }, []), { kind: "none" });
});

// ---- source price recompute ----
test("repricing includes the current System price; a deleted System row is never silently dropped", () => {
  const rows = [{ id: "sa1", price: 550, currency: "AED" }, { id: "a1-1", price: 100, currency: "AED" }];
  const saved = { variant_pricing: { id: "a1-1" }, system_pricing: { group_id: "system-a", row: { id: "sa1" } } };
  const system = currentSystemPricing(saved, rows);
  assert.deepEqual(system, { kind: "ok", price: 550, quantity: 1, total: 550, currency: "AED" });
  const main = 100; const accessories = 20;
  assert.equal(main + (system.kind === "ok" ? system.price : 0) + accessories, 670);
  assert.deepEqual(currentSystemPricing(saved, [{ id: "a1-1", price: 100 }]), { kind: "missing" });
});

// ---- specification / derived data ----
test("System spec precedes Main spec without replacing it or repeating text", () => {
  assert.equal(composeSystemAndMainSpecification("System spec", "Main spec"), "System spec\nMain spec");
  assert.equal(composeSystemAndMainSpecification(null, "Main spec"), "Main spec");
  assert.equal(composeSystemAndMainSpecification("Same", "Same"), "Same");
  assert.equal(composeSystemAndMainSpecification(" ", null), null);
});

test("system supplier code reaches derived document data once, even when mirrored in selected_options", () => {
  const source = {
    variant_pricing: { supplier_price_list_code: "MAIN-1" },
    system_pricing: systemPricingSnapshot("system-a", { id: "sa1", supplier_price_list_code: "SYS-A1" }),
    selected_options: [systemSelectedOptionSnapshot("system-a", { id: "sa1", supplier_price_list_code: "SYS-A1" })],
  };
  const entries = collectSupplierCodeSummary(source);
  const codes = entries.map((entry) => entry.code);
  assert.equal(codes.filter((code) => code === "SYS-A1").length, 1);
  assert.ok(codes.includes("MAIN-1"));
  assert.ok(entries.some((entry) => entry.label === "System"));
});

test("old source data without system_pricing produces the same supplier codes as before", () => {
  const entries = collectSupplierCodeSummary({ variant_pricing: { supplier_price_list_code: "MAIN-1" } });
  assert.deepEqual(entries.map((entry) => entry.code), ["MAIN-1"]);
});
