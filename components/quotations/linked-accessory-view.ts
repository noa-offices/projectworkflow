/**
 * Display-only view of a linked product's accessories: grouping, compatibility filtering and labels.
 * It never decides what can be selected or what it costs; selection state and totals stay with the builder.
 */
import {
  resolveAccessoryApplicabilityTarget,
  type AccessoryConditionalConfiguration,
} from "../../lib/products/accessory-conditional-configuration";

export type LinkedAccessoryViewItem = {
  id?: string;
  item_name?: string;
  supplier_price_list_code?: string;
  dimension?: string;
  specification?: string;
  importantRequirements?: string[];
};

export type LinkedAccessoryViewGroup<Item extends LinkedAccessoryViewItem> = {
  id: string;
  group_name: string;
  group_is_required: boolean;
  items: Item[];
  conditional_configuration?: AccessoryConditionalConfiguration;
};

/** The linked product's own chosen row. Parent-product rows are deliberately not part of this. */
export type LinkedAccessorySelectedRow = { kind: "price_matrix" | "base_model"; rowId: string } | null;

/** The key the builder has always used for linked accessory quantities. */
export const linkedAccessoryId = (item: LinkedAccessoryViewItem) => item.id ?? item.item_name ?? "";

export function linkedAccessoryName(item: LinkedAccessoryViewItem) {
  const title = item.item_name?.trim() ?? "";
  const code = item.supplier_price_list_code?.trim() ?? "";
  const size = item.dimension?.trim() ?? "";
  const includes = (part: string) => title.toLocaleLowerCase().includes(part.toLocaleLowerCase());
  const name = [code && !includes(code) ? code : "", title].filter(Boolean).join(" ") || "Accessory";
  return size && !includes(size) ? `${name} · ${size}` : name;
}

export function linkedAccessoryDetails(item: LinkedAccessoryViewItem) {
  return [item.specification, ...(item.importantRequirements ?? [])]
    .map((text) => text?.trim() ?? "")
    .filter(Boolean);
}

export const toggledLinkedAccessoryQuantity = (checked: boolean, quantity: number) =>
  checked ? Math.max(1, quantity || 1) : 0;

export const typedLinkedAccessoryQuantity = (value: string) => Math.max(1, Math.trunc(Number(value) || 1));

/**
 * Item ids that the group's saved rules allow for the chosen row, or null when the rules say nothing:
 * no row chosen, or no rule names a row of the linked product itself. Free text is never read.
 */
function compatibleIds<Item extends LinkedAccessoryViewItem>(
  group: LinkedAccessoryViewGroup<Item>,
  selectedRow: LinkedAccessorySelectedRow,
  ownRowIds: ReadonlySet<string>,
) {
  if (!selectedRow) return null;
  const ownRules = (group.conditional_configuration?.applicability ?? []).flatMap((rule) => {
    const target = resolveAccessoryApplicabilityTarget(rule);
    return target && target.kind === selectedRow.kind && ownRowIds.has(target.row_id) ? [{ rule, rowId: target.row_id }] : [];
  });
  if (!ownRules.length) return null;
  const allIds = group.items.map(linkedAccessoryId);
  return new Set(ownRules
    .filter(({ rule, rowId }) => rowId === selectedRow.rowId && rule.visible)
    .flatMap(({ rule }) => rule.allowed_item_ids ?? allIds));
}

export function buildLinkedAccessoryView<Item extends LinkedAccessoryViewItem, Group extends LinkedAccessoryViewGroup<Item>>({
  groups,
  quantities,
  selectedRow,
  ownRowIds,
  showAll,
}: {
  groups: Group[];
  quantities: Record<string, number>;
  selectedRow: LinkedAccessorySelectedRow;
  ownRowIds: readonly string[];
  showAll: boolean;
}) {
  const own = new Set(ownRowIds);
  const quantityOf = (item: Item) => quantities[linkedAccessoryId(item)] ?? 0;
  let hiddenCount = 0;
  const selected: Array<{ id: string; name: string; quantity: number }> = [];

  const entries = groups.flatMap((group) => {
    const items: Item[] = group.items;
    const allowed = compatibleIds<Item>(group, selectedRow, own);
    let compatible = allowed ? items.filter((item) => allowed.has(linkedAccessoryId(item)) || quantityOf(item) > 0) : items;
    // A required group never disappears.
    if (!compatible.length && group.group_is_required) compatible = items;
    hiddenCount += items.length - compatible.length;
    items.filter((item) => quantityOf(item) > 0).forEach((item) => {
      selected.push({ id: linkedAccessoryId(item), name: linkedAccessoryName(item), quantity: quantityOf(item) });
    });
    const shown = showAll ? items : compatible;
    const selectedCount = items.filter((item) => quantityOf(item) > 0).length;
    const chooseOne = group.conditional_configuration?.selection === "exactly_one";
    return shown.length ? [{ group, items: shown, selectedCount, required: group.group_is_required, chooseOne }] : [];
  });

  return { groups: entries, hiddenCount, selected };
}

export function linkedAccessorySummary(selected: Array<{ name: string; quantity: number }>) {
  if (!selected.length) return "Selected accessories: none";
  const names = selected.map((entry) => entry.quantity > 1 ? `${entry.name} × ${entry.quantity}` : entry.name);
  return `Selected accessories (${selected.length}): ${names.join(", ")}`;
}
