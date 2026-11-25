import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { evaluateProductAccessorySelection } from "../../lib/quotations/product-accessory-configuration";
import {
  AccessoryBlockedList,
  AccessoryGroupCounts,
  accessoryBlockedEntries,
  accessoryGroupBadge,
  AccessoryGroupsToolbar,
  requiredGroupsSummary,
  revealAccessoryGroup,
} from "./accessory-group-status";
import { LinkedAccessoryList } from "./linked-accessory-list";

const groups = [
  { id: "front", group_name: "Front Stirrups Kit", group_is_required: true, items: [{ id: "f1", item_name: "Front kit", price: 10 }] },
  { id: "central", group_name: "Central Stirrup", group_is_required: true, items: [{ id: "c1", item_name: "Central A", price: 20 }, { id: "c2", item_name: "Central B", price: 21 }], conditional_configuration: { role: "accessory" as const, selection: "exactly_one" as const, applicability: [] } },
  { id: "extra", group_name: "Extras", group_is_required: false, items: [{ id: "e1", item_name: "Extra one", price: 5 }] },
];

const Header = (props: { expanded: boolean; groupName: string; itemCount: number; required: boolean; chooseOne: boolean; selectedCount: number; onToggle: () => void }) => (
  <button type="button" aria-expanded={props.expanded}>{props.groupName} <AccessoryGroupCounts itemCount={props.itemCount} selectedCount={props.selectedCount} required={props.required} chooseOne={props.chooseOne} /></button>
);

const renderLinked = (quantities: Record<string, number> = {}) => renderToStaticMarkup(
  <LinkedAccessoryList title="Universal Screen Accessories" groups={groups} quantities={quantities} selectedRow={null} ownRowIds={[]} priceLabel={(item) => `AED ${(item as { price?: number }).price}`} GroupHeader={Header} onQuantityChange={() => {}} />,
);

test("every linked group is closed on first render, including required and selected ones", () => {
  for (const quantities of [{}, { f1: 1, c2: 1, e1: 2 }] as Array<Record<string, number>>) {
    const html = renderLinked(quantities);
    assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 3);
    assert.ok(!html.includes('aria-expanded="true"'));
    assert.ok(!html.includes('type="checkbox"'));
  }
});

test("headers show item and selected counts, a warning badge while a required group is empty, and a tick once satisfied", () => {
  const counts = (required: boolean, chooseOne: boolean, selectedCount: number) => renderToStaticMarkup(<AccessoryGroupCounts itemCount={2} selectedCount={selectedCount} required={required} chooseOne={chooseOne} />);
  assert.match(counts(true, false, 0), /2 items · 0 selected.*text-amber-[^>]*>Required</);
  assert.match(counts(true, true, 0), />Choose 1</);
  assert.match(counts(true, false, 2), /2 items · 2 selected.*text-emerald-[^>]*><span aria-hidden="true">✓ <\/span>Required chosen</);
  assert.ok(!counts(false, false, 0).includes("Required"));
  assert.ok(!counts(false, true, 0).includes("Choose 1"), "an optional pick-one group is not marked as required");
  assert.deepEqual(accessoryGroupBadge({ required: true, chooseOne: true, selectedCount: 2 }), { satisfied: false, text: "Choose 1" });
});

test("the required summary appears only when there are required groups, above the selected line", () => {
  assert.equal(requiredGroupsSummary([{ required: false, chooseOne: false, selectedCount: 1 }]), null);
  assert.equal(requiredGroupsSummary([{ required: true, chooseOne: false, selectedCount: 3 }, { required: true, chooseOne: true, selectedCount: 0 }]), "Required: 1 of 2 groups chosen");
  const html = renderLinked({ f1: 1 });
  assert.ok(html.indexOf("Required: 1 of 2 groups chosen") > -1);
  assert.ok(html.indexOf("Required: 1 of 2 groups chosen") < html.indexOf("Selected accessories (1): Front kit"));
});

test("the toolbar offers Expand all until every group is open, then Collapse all", () => {
  const toolbar = (allExpanded: boolean) => renderToStaticMarkup(<AccessoryGroupsToolbar groups={[{ required: false, chooseOne: false, selectedCount: 0 }]} allExpanded={allExpanded} onSetAll={() => {}} />);
  assert.match(toolbar(false), /<button type="button"[^>]*>Expand all<\/button>/);
  assert.match(toolbar(true), />Collapse all<\/button>/);
  assert.match(renderLinked(), />Expand all<\/button>/);
});

function findButtons(node: ReactNode): ReactElement<{ onClick: () => void; children: ReactNode }>[] {
  if (Array.isArray(node)) return node.flatMap(findButtons);
  if (!isValidElement<{ onClick: () => void; children: ReactNode }>(node)) return [];
  return [...(node.type === "button" ? [node] : []), ...findButtons(node.props.children)];
}

test("the blocked-Add message names each blocking group, in the wording of its rule", () => {
  const evaluation = evaluateProductAccessorySelection({ accessoryGroups: groups, selectedQuantities: {} });
  assert.deepEqual(evaluation.blockingRequirements.map((entry) => entry.groupId), ["front", "central"], "blocking rules are the existing ones");
  assert.deepEqual(accessoryBlockedEntries(evaluation.blockingRequirements, groups, evaluation.groups), [
    { groupId: "front", text: 'Choose at least one item in "Front Stirrups Kit".' },
    { groupId: "central", text: 'Choose 1 item in "Central Stirrup".' },
  ]);
  assert.deepEqual(accessoryBlockedEntries([{ code: "too_many_selections", groupId: "central", message: "Select no more than one item from this group." }], groups, evaluation.groups), [{ groupId: "central", text: '"Central Stirrup": Select no more than one item from this group.' }]);
  assert.deepEqual(accessoryBlockedEntries([{ code: "unknown_item", groupId: "accessory_pricing", message: "x" }], groups, evaluation.groups), [{ groupId: "accessory_pricing", text: "x" }]);
});

test("clicking a blocked message opens that group, and revealing scrolls to it and focuses its header", () => {
  const opened: string[] = [];
  const tree = AccessoryBlockedList({ entries: [{ groupId: "front", text: "Front" }, { groupId: "central", text: "Central" }], onOpen: (id) => opened.push(id) });
  findButtons(tree)[1]!.props.onClick();
  assert.deepEqual(opened, ["central"]);

  const calls: string[] = [];
  const target = (id: string) => ({ getAttribute: () => id, scrollIntoView: () => calls.push(`scroll:${id}`), querySelector: () => ({ focus: () => calls.push(`focus:${id}`) }) });
  const root = { querySelectorAll: () => [target("front"), target("central")] } as unknown as ParentNode;
  assert.equal(revealAccessoryGroup(root, "central"), true);
  assert.deepEqual(calls, ["scroll:central", "focus:central"]);
  assert.equal(revealAccessoryGroup(root, "missing"), false);
});

test("builder wiring: all groups default closed; selection, quantity and price code is untouched", () => {
  const source = readFileSync(new URL("./product-library-selector.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(!source.includes("(groupHasNoSelection || selectedCount > 0)"));
  assert.ok(!source.includes("evaluation.required || selectedCount > 0 || Boolean(validationMessage)"));
  [
    "isGroupExpanded(group.id, false)",
    "<AccessoryGroupsToolbar",
    "<AccessoryBlockedList",
    "revealAccessoryGroup(document, groupId)",
    "data-accessory-group={group.id}",
    // the blocking rules
    "const missingRequiredAccessorySelection = !accessoryConfiguration.valid || missingConditionalModelSelection;",
    // what goes to the quote
    "qty: Math.max(0, Math.trunc(numberValue(accessoryConfiguration.activeQuantities[id]))),",
    'name="accessory_pricing_qty"',
    'name="linked_product_accessory_qty"',
    "[line.instanceKey]: { ...(current[line.instanceKey] ?? {}), [id]: quantity },",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected: ${expected}`));
});
