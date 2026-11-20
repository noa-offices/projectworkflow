import { orderedItems, type LocalQuotationItem, type LocalQuotationWorkspace } from "./quotation-workspace";

/**
 * Bulk row actions for the local quotation builder. These only decide WHICH rows change and in what ORDER. The discount itself is applied
 * by the builder's existing single-row editor (updateItem) with the patch below, and totals are computed by the existing workspace code.
 */

const NOT_PRICED_TYPES = new Set(["note", "blank", "subtotal", "heading"]);
const NOT_PRICED_STYLES = new Set(["note", "heading"]);

/** The same field shape the single-row discount editor sets. */
export const bulkPercentPatch = (value: number) => ({ discount_type: "percent" as const, discount_value: value });

export function parseBulkPercent(text: string): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = text.trim();
  const value = Number(trimmed);
  if (!trimmed || !Number.isFinite(value)) return { ok: false, message: "Enter a discount between 0 and 100." };
  if (value < 0 || value > 100) return { ok: false, message: "The discount must be between 0 and 100." };
  return { ok: true, value };
}

/** Rows that can carry a discount (notes, blank rows, headings and subtotal rows cannot). */
export const canTakeBulkPercent = (item: Pick<LocalQuotationItem, "item_type" | "line_style">) =>
  !NOT_PRICED_TYPES.has(item.item_type) && !NOT_PRICED_STYLES.has(item.line_style);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function bulkPercentMessage(changed: number, skipped: number) {
  return `Discount set on ${plural(changed, "row")}${skipped ? ` (${skipped} skipped: no discount on that row type)` : ""}.`;
}

/** Deleting a parent row also deletes its optional child rows. A selected optional child alone is deleted alone. */
export function bulkDeletePlan(items: readonly LocalQuotationItem[], selectedIds: ReadonlySet<string>) {
  const selected = items.filter((item) => selectedIds.has(item.id));
  const children = items.filter((item) => item.is_optional && item.parent_item_id && selectedIds.has(item.parent_item_id) && !selectedIds.has(item.id));
  const rowCount = selected.length;
  const optionalCount = children.length;
  return {
    ids: [...selected, ...children].map((item) => item.id),
    rowCount,
    optionalCount,
    question: `Delete ${plural(rowCount, "row")}${optionalCount ? ` and ${plural(optionalCount, "optional item")}` : ""}?`,
    done: `Deleted ${plural(rowCount, "row")}${optionalCount ? ` and ${plural(optionalCount, "optional item")}` : ""}.`,
  };
}

/**
 * Each selected row gets one copy directly below itself (same copy shape as the single-row Duplicate). Sort orders in the affected
 * sections are renumbered so the order is exactly [A, A', B, B', ...]; nothing else changes. The copies are new rows (not selected).
 */
export function duplicateRowsBelow(
  workspace: LocalQuotationWorkspace,
  selectedIds: ReadonlySet<string>,
  makeId: (source: LocalQuotationItem) => string,
  now: string,
): LocalQuotationWorkspace {
  const sectionIds = new Set(workspace.items.filter((item) => selectedIds.has(item.id)).map((item) => item.section_id));
  if (!sectionIds.size) return workspace;
  const sortById = new Map<string, number>();
  const copies: LocalQuotationItem[] = [];
  for (const sectionId of sectionIds) {
    let position = 0;
    for (const item of orderedItems(workspace.items, sectionId)) {
      sortById.set(item.id, position++);
      if (!selectedIds.has(item.id)) continue;
      copies.push({
        ...item,
        id: makeId(item),
        source_item_id: item.source_item_id ?? item.id,
        sort_order: position++,
        updated_at: now,
      });
    }
  }
  return {
    ...workspace,
    items: [
      ...workspace.items.map((item) => (sortById.has(item.id) && sortById.get(item.id) !== item.sort_order ? { ...item, sort_order: sortById.get(item.id)! } : item)),
      ...copies,
    ],
  };
}

/**
 * Moves the selected rows (in the given display order) to the end of the target section. Optional child rows move with their parent.
 * An optional child selected without its parent is refused, because it would lose its main row in the other section.
 */
export function moveRowsToSectionEnd(
  workspace: LocalQuotationWorkspace,
  orderedSelectedIds: readonly string[],
  targetSectionId: string,
): { ok: true; workspace: LocalQuotationWorkspace; moved: number } | { ok: false; message: string } {
  const byId = new Map(workspace.items.map((item) => [item.id, item]));
  const selected = orderedSelectedIds.map((id) => byId.get(id)).filter((item): item is LocalQuotationItem => Boolean(item));
  if (!selected.length) return { ok: false, message: "Select at least one row to move." };
  const selectedSet = new Set(selected.map((item) => item.id));
  if (selected.some((item) => item.is_optional && item.parent_item_id && !selectedSet.has(item.parent_item_id) && byId.has(item.parent_item_id))) {
    return { ok: false, message: "Optional items move with their main row. Select the main row too." };
  }
  const tops = selected.filter((item) => !(item.is_optional && item.parent_item_id && selectedSet.has(item.parent_item_id)));
  const order: LocalQuotationItem[] = [];
  for (const top of tops) {
    order.push(top);
    for (const child of orderedItems(workspace.items, top.section_id)) {
      if (child.is_optional && child.parent_item_id === top.id) order.push(child);
    }
  }
  const movingIds = new Set(order.map((item) => item.id));
  const staying = workspace.items.filter((item) => item.section_id === targetSectionId && !movingIds.has(item.id) && item.is_active !== false);
  let next = staying.reduce((max, item) => Math.max(max, item.sort_order), -1) + 1;
  const placed = new Map(order.map((item) => [item.id, next++]));
  return {
    ok: true,
    moved: tops.length,
    workspace: {
      ...workspace,
      items: workspace.items.map((item) => (placed.has(item.id) ? { ...item, section_id: targetSectionId, sort_order: placed.get(item.id)! } : item)),
    },
  };
}
