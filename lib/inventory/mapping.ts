import { LOCATION_QUANTITY_COLUMNS } from "./types";
import type { InventoryCategory, InventoryCategoryNode, InventoryCategoryOverview, InventoryCosts, InventoryImageRow, InventoryMovementRequestRow, InventoryMovementRow, InventoryPage, InventoryProductRequestRow, InventoryProductRow, InventoryProductSummary, InventoryStockSummary } from "./types";

const identity = ["id", "brand_id", "category_id", "subcategory_id", "custom_category_name", "stock_ref", "item_code", "item_name", "model_name", "description", "condition", "source", "note", "dimension_length", "dimension_width", "dimension_height", "dimension_unit", "item_type", "quantity", "created_at", "updated_at"] as const;
export const PRODUCT_COLUMNS = [...identity, ...Object.values(LOCATION_QUANTITY_COLUMNS), "low_stock_at", "status", "location", "is_active", "removed_at", "removed_by", "removal_reason", "created_by", "updated_by"] as const satisfies readonly (keyof InventoryProductRow)[];
export const PRODUCT_REQUEST_COLUMNS = [...identity, "initial_stock", "requested_status", "request_status", "submitted_by", "submitted_at", "reviewed_by", "reviewed_at", "review_note", "approved_product_id"] as const satisfies readonly (keyof InventoryProductRequestRow)[];
export const SUMMARY_COLUMNS = ["id", "brand_id", "stock_ref", "item_code", "item_name", "model_name"] as const satisfies readonly (keyof InventoryProductSummary)[];
export const COST_COLUMNS = ["price", "freight_cost", "c_and_f", "transport", "custom_duty", "labour", "vat", "total_cost"] as const satisfies readonly (keyof InventoryCosts)[];
export const IMAGE_COLUMNS = ["id", "product_id", "product_request_id", "storage_bucket", "storage_path", "file_name", "content_type", "size_bytes", "sort_order", "is_main", "alt_text", "uploaded_by", "created_at", "updated_at"] as const satisfies readonly (keyof InventoryImageRow)[];
export const CATEGORY_COLUMNS = ["id", "parent_id", "name", "slug", "is_active", "sort_order", "created_at", "updated_at"] as const satisfies readonly (keyof InventoryCategory)[];
export const MOVEMENT_COLUMNS = ["id", "product_id", "movement_type", "action_type", "from_location", "to_location", "quantity", "previous_quantity", "new_quantity", "note", "reference_type", "reference_id", "created_by", "created_at"] as const satisfies readonly (keyof InventoryMovementRow)[];
export const MOVEMENT_REQUEST_COLUMNS = ["project_id", "project_label", "reference_note", "expires_at", "approved_reservation_id", "id", "product_id", "request_type", "movement_type", "action_type", "from_location", "to_location", "quantity", "note", "request_status", "submitted_by", "submitted_at", "reviewed_by", "reviewed_at", "review_note", "approved_movement_id", "created_at", "updated_at"] as const satisfies readonly (keyof InventoryMovementRequestRow)[];

// Copy only the selected fields, never unknown properties from a database response.
export function pick<T, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map(key => [key, row[key]])) as Pick<T, K>;
}
export function pageResult<T>(items: T[], total: number, page: number, pageSize: number): InventoryPage<T> {
  return { items, total, page, page_size: pageSize, page_count: Math.ceil(total / pageSize) };
}
export type StockRow = Pick<InventoryProductRow, "quantity" | "low_stock_at" | typeof LOCATION_QUANTITY_COLUMNS[keyof typeof LOCATION_QUANTITY_COLUMNS]> & Partial<Pick<InventoryProductRow, "item_type">>;
export const STOCK_COLUMNS = ["quantity", "low_stock_at", "item_type", ...Object.values(LOCATION_QUANTITY_COLUMNS)] as const;
export function summarizeStock(rows: readonly StockRow[]): InventoryStockSummary {
  const result: InventoryStockSummary = {
    product_count: 0, total_live_quantity: 0, low_stock_count: 0,
    location_quantities: { warehouse: 0, dubai_showroom: 0, abudhabi_showroom: 0, mockup: 0, temporary_out: 0, sold: 0 },
    location_product_counts: { warehouse: 0, dubai_showroom: 0, abudhabi_showroom: 0, mockup: 0, temporary_out: 0, sold: 0 },
    item_type_counts: { product: 0, accessory: 0, temporary: 0 },
  };
  for (const row of rows) {
    result.total_live_quantity += row.quantity;
    if (row.quantity > 0) {
      result.product_count++;
      if (row.item_type) result.item_type_counts[row.item_type]++;
    }
    if (row.quantity <= row.low_stock_at) result.low_stock_count++;
    for (const location of Object.keys(LOCATION_QUANTITY_COLUMNS) as (keyof typeof LOCATION_QUANTITY_COLUMNS)[]) {
      const units = row[LOCATION_QUANTITY_COLUMNS[location]];
      result.location_quantities[location] += units;
      if (units > 0) result.location_product_counts[location]++;
    }
  }
  return result;
}
export function categoryTree(rows: readonly InventoryCategory[]): InventoryCategoryNode[] {
  const nodes = new Map(rows.map(row => [row.id, { ...pick(row, CATEGORY_COLUMNS), children: [] as InventoryCategoryNode[] }]));
  if (nodes.size !== rows.length) throw new Error("Invalid inventory category hierarchy");
  const roots: InventoryCategoryNode[] = [];
  for (const node of nodes.values()) {
    const seen = new Set([node.id]);
    let ancestor = node.parent_id ? nodes.get(node.parent_id) : undefined;
    while (ancestor) {
      if (seen.has(ancestor.id)) throw new Error("Invalid inventory category hierarchy");
      seen.add(ancestor.id);
      ancestor = ancestor.parent_id ? nodes.get(ancestor.parent_id) : undefined;
    }
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  function sort(nodes: InventoryCategoryNode[]) {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    for (const node of nodes) sort(node.children);
  }
  sort(roots);
  return roots;
}

/** Adds the number of products using each category (top level) or subcategory (children). */
export function withCategoryCounts(tree: readonly InventoryCategoryNode[], products: readonly { category_id: string; subcategory_id: string | null }[]): InventoryCategoryOverview[] {
  const byCategory = new Map<string, number>(), bySubcategory = new Map<string, number>();
  for (const product of products) {
    byCategory.set(product.category_id, (byCategory.get(product.category_id) ?? 0) + 1);
    if (product.subcategory_id) bySubcategory.set(product.subcategory_id, (bySubcategory.get(product.subcategory_id) ?? 0) + 1);
  }
  const count = (node: InventoryCategoryNode, top: boolean): InventoryCategoryOverview => ({ ...node, item_count: (top ? byCategory : bySubcategory).get(node.id) ?? 0, children: node.children.map(child => count(child, false)) });
  return tree.map(node => count(node, true));
}
