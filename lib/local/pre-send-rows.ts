import type { PreSendRow } from "../quotations/pre-send-checks";
import { workspaceItemDisplayPricing, type LocalQuotationItem, type LocalQuotationWorkspace } from "./quotation-workspace";

/**
 * The facts the pre-send checks read from the in-memory workspace. READ-ONLY: the unit price is the one the builder already shows
 * (workspaceItemDisplayPricing), nothing is recomputed or written. Rows without a number (notes, blank rows, headings) are left out.
 */
export function preSendRowsFromWorkspace(
  workspace: LocalQuotationWorkspace,
  rowNumbers: ReadonlyMap<string, number>,
  countsInTotals: (item: LocalQuotationItem) => boolean,
): PreSendRow[] {
  return workspace.items
    .filter((item) => rowNumbers.has(item.id))
    .map((item) => ({
      id: item.id,
      rowNumber: rowNumbers.get(item.id) ?? 0,
      name: item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || "",
      itemType: item.item_type,
      countsInTotals: countsInTotals(item),
      qty: item.qty,
      unitPrice: workspaceItemDisplayPricing(workspace, item).unitPrice,
      discountType: item.discount_type,
      discountValue: item.discount_value,
      hasImage: Boolean(item.proposed_image_url_snapshot?.trim()),
      hasSpecification: Boolean(item.specification_snapshot?.trim()),
    }))
    .sort((a, b) => a.rowNumber - b.rowNumber);
}
