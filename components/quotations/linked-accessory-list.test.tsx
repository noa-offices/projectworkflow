import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildLinkedAccessoryView,
  linkedAccessoryDetails,
  linkedAccessoryName,
  linkedAccessorySummary,
  toggledLinkedAccessoryQuantity,
  typedLinkedAccessoryQuantity,
  type LinkedAccessoryViewGroup,
} from "./linked-accessory-view";
import { LinkedAccessoryList, LinkedAccessoryRow } from "./linked-accessory-list";

type Item = { id?: string; item_name?: string; supplier_price_list_code?: string; dimension?: string; specification?: string; importantRequirements?: string[]; price?: number };

const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, item_name: `Item ${id}`, price: 10, ...extra });
const group = (id: string, items: Item[], extra: Partial<LinkedAccessoryViewGroup<Item>> = {}): LinkedAccessoryViewGroup<Item> => ({ id, group_name: `Group ${id}`, group_is_required: false, items, ...extra });

const rowRule = (rowId: string, allowed?: string[], visible = true) => ({ required: false, visible, target: { kind: "price_matrix" as const, group_id: "screens", row_id: rowId }, allowed_item_ids: allowed });
const configured = (applicability: ReturnType<typeof rowRule>[]) => ({ role: "accessory" as const, selection: "unrestricted" as const, applicability });
const context = { selectedRow: { kind: "price_matrix" as const, rowId: "desk-60" }, ownRowIds: ["desk-60", "desk-80"] };
const view = (groups: LinkedAccessoryViewGroup<Item>[], quantities: Record<string, number> = {}, showAll = false) => buildLinkedAccessoryView({ groups, quantities, showAll, ...context });
const ids = (result: ReturnType<typeof view>) => result.groups.map((entry) => [entry.group.id, entry.items.map((row) => row.id)]);

const StubHeader = ({ expanded, groupName, itemCount, selectedCount }: { expanded: boolean; groupName: string; itemCount: number; required: boolean; selectedCount: number; onToggle: () => void }) => (
  <button type="button" aria-expanded={expanded}>{`${groupName} | ${itemCount} items | ${selectedCount} selected`}</button>
);

const render = (groups: LinkedAccessoryViewGroup<Item>[], quantities: Record<string, number> = {}) => renderToStaticMarkup(
  <LinkedAccessoryList title="Universal Screen Accessories / Optional Items" groups={groups} quantities={quantities} priceLabel={(row) => `AED ${row.price}`} GroupHeader={StubHeader} onQuantityChange={() => {}} {...context} />,
);

test("groups keep their order with item and selected counts, closed until opened", () => {
  const groups = [group("a", [item("a1"), item("a2")]), group("b", [item("b1")])];
  const result = view(groups, { a2: 3 });
  assert.deepEqual(result.groups.map((entry) => [entry.items.length, entry.selectedCount]), [[2, 1], [1, 0]]);
  const html = render(groups);
  assert.match(html, /Group a \| 2 items \| 0 selected/);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2);
  assert.ok(!html.includes("Item a1"));
});

test("every group starts closed, so no row is shown until it is opened", () => {
  const html = render([group("req", [item("r1")], { group_is_required: true }), group("sel", [item("s1")]), group("other", [item("o1")])], { s1: 1 });
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 3);
  assert.ok(!html.includes('type="checkbox"'));
});

const rowMarkup = (row: Item, quantity: number, name = linkedAccessoryName(row)) => renderToStaticMarkup(
  <LinkedAccessoryRow id={row.id!} name={name} details={linkedAccessoryDetails(row)} detailsId="d" detailsOpen={false} onToggleDetails={() => {}} price={`AED ${row.price}`} quantity={quantity} onQuantityChange={() => {}} />,
);

test("quantity box appears only on a checked row and shows the stored quantity", () => {
  assert.ok(!rowMarkup(item("s2"), 0).includes('type="number"'));
  const checked = rowMarkup(item("s1"), 4);
  assert.match(checked, /aria-label="Quantity for Item s1"/);
  assert.match(checked, /value="4"/);
  assert.match(checked, /type="checkbox"/);
});

test("row shows code, title and price; long text stays behind a closed details button", () => {
  const long = "Set of 2 lateral stirrups for desks or bench, desk depth 60-70.";
  const kit = item("k", { item_name: "Lateral Stirrups Kit Art.881 (set of 2)", supplier_price_list_code: "881", specification: long, importantRequirements: ["Needs a bracket"] });
  const html = rowMarkup(kit, 0);
  assert.ok(html.includes("Lateral Stirrups Kit Art.881 (set of 2)"));
  assert.ok(html.includes("AED 10"));
  assert.ok(!html.includes(long));
  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*aria-label="Details for /);
  assert.deepEqual(linkedAccessoryDetails(kit), [long, "Needs a bracket"]);
});

test("short name joins code and title without repeating, and keeps a size that tells rows apart", () => {
  assert.equal(linkedAccessoryName(item("1", { item_name: "Glass Raiser", supplier_price_list_code: "TG12" })), "TG12 Glass Raiser");
  assert.equal(linkedAccessoryName(item("1", { item_name: "TG12 Glass Raiser", supplier_price_list_code: "TG12" })), "TG12 Glass Raiser");
  assert.equal(linkedAccessoryName(item("1", { item_name: "Glass Raiser", dimension: "120x35" })), "Glass Raiser · 120x35");
  assert.equal(linkedAccessoryName(item("1", { item_name: "Glass Raiser 120x35", dimension: "120x35" })), "Glass Raiser 120x35");
});

test("without compatibility rules every item is shown, whatever the description says", () => {
  const result = view([group("a", [item("a1", { specification: "desk depth 60-70" }), item("a2", { specification: "desk depth 80" })])]);
  assert.deepEqual(ids(result), [["a", ["a1", "a2"]]]);
  assert.equal(result.hiddenCount, 0);
});

test("rules that do not name the linked product's own rows hide nothing", () => {
  const parentRules = configured([rowRule("parent-desk", ["a1"])]);
  assert.deepEqual(ids(view([group("a", [item("a1"), item("a2")], { conditional_configuration: parentRules })])), [["a", ["a1", "a2"]]]);
});

test("own-row rules show compatible items, and Show all brings back the rest", () => {
  const groups = [
    group("a", [item("a1"), item("a2")], { conditional_configuration: configured([rowRule("desk-60", ["a1"])]) }),
    group("b", [item("b1")], { conditional_configuration: configured([rowRule("desk-80")]) }),
  ];
  assert.deepEqual(ids(view(groups)), [["a", ["a1"]]]);
  assert.equal(view(groups).hiddenCount, 2);
  assert.deepEqual(ids(view(groups, {}, true)), [["a", ["a1", "a2"]], ["b", ["b1"]]]);
  assert.equal(view(groups, {}, true).hiddenCount, 2, "the toggle stays available");
});

test("selected and required items are never hidden by compatibility", () => {
  const rules = configured([rowRule("desk-80")]);
  assert.deepEqual(ids(view([group("a", [item("a1"), item("a2")], { conditional_configuration: rules })], { a2: 1 })), [["a", ["a2"]]]);
  assert.deepEqual(ids(view([group("a", [item("a1")], { conditional_configuration: rules, group_is_required: true })])), [["a", ["a1"]]]);
});

test("selected summary counts and names chosen accessories, including quantities", () => {
  const groups = [group("a", [item("a1"), item("a2")]), group("b", [item("b1")])];
  assert.equal(linkedAccessorySummary(view(groups).selected), "Selected accessories: none");
  assert.equal(linkedAccessorySummary(view(groups, { a1: 1, b1: 3 }).selected), "Selected accessories (2): Item a1, Item b1 × 3");
  assert.ok(render(groups, { b1: 3 }).includes("Selected accessories (1): Item b1 × 3"));
});

test("quantity rules are the previous ones", () => {
  assert.deepEqual([toggledLinkedAccessoryQuantity(true, 0), toggledLinkedAccessoryQuantity(true, 5), toggledLinkedAccessoryQuantity(false, 5)], [1, 5, 0]);
  assert.deepEqual(["3", "2.9", "0", "-4", "", "x"].map(typedLinkedAccessoryQuantity), [3, 2, 1, 1, 1, 1]);
});

function findAll(node: ReactNode, match: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, match));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(match(node) ? [node] : []), ...findAll(node.props.children as ReactNode, match)];
}

test("row controls send the same item id and quantity to the quote state as before", () => {
  const sent: Array<[string, number]> = [];
  const row = (id: string, quantity: number) => LinkedAccessoryRow({ id, name: id, details: [], detailsId: `d-${id}`, detailsOpen: false, onToggleDetails: () => {}, price: "AED 10", quantity, onQuantityChange: (itemId, next) => sent.push([itemId, next]) });
  const change = (tree: ReactNode, type: string, target: Record<string, unknown>) => (findAll(tree, (element) => element.type === "input" && element.props.type === type)[0]!.props.onChange as (event: unknown) => void)({ target });

  change(row("a1", 0), "checkbox", { checked: true });
  change(row("a1", 2), "number", { value: "7" });
  change(row("a1", 7), "checkbox", { checked: false });
  assert.deepEqual(sent, [["a1", 1], ["a1", 7], ["a1", 0]]);
});

test("an item without an id is still keyed by its name", () => {
  const result = view([group("a", [{ item_name: "Legacy clamp" }])], { "Legacy clamp": 2 });
  assert.deepEqual(result.selected, [{ id: "Legacy clamp", name: "Legacy clamp", quantity: 2 }]);
});

test("builder wires the list to the unchanged linked quantity state and the standalone header", () => {
  const source = readFileSync(new URL("./product-library-selector.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  [
    "<LinkedAccessoryList",
    "GroupHeader={AccessoryGroupHeader}",
    "quantities={linkedAccessoryQuantities[line.instanceKey] ?? {}}",
    "priceLabel={(accessory) => formatMoney(accessory.currency ?? line.currency, numberValue(accessory.price))}",
    "[line.instanceKey]: { ...(current[line.instanceKey] ?? {}), [id]: quantity },",
    "accessoryQuantities: linkedAccessoryQuantities[instanceKey] ?? {},",
    ".reduce((total, line) => total + line.qty * numberValue(line.accessory.price), 0);",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected linked accessory wiring: ${expected}`));
});
