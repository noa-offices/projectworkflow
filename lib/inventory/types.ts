export const LOCATION_LABELS = {
  warehouse: "Warehouse",
  dubai_showroom: "Dubai Showroom",
  abudhabi_showroom: "Abu Dhabi Showroom",
  mockup: "Mockup",
  temporary_out: "Temporary Out",
  sold: "Sold",
} as const;
export type InventoryLocation = keyof typeof LOCATION_LABELS;
export const PRODUCT_STATUSES = ["available", "reserved", "showroom", "missing", "sold", "hold"] as const;
export type ProductStatus = typeof PRODUCT_STATUSES[number];
export const REQUEST_STATUSES = ["pending_review", "approved", "rejected"] as const;
export type RequestStatus = typeof REQUEST_STATUSES[number];
export const REQUEST_TYPES = ["take", "move", "hold", "book"] as const;
export type RequestType = typeof REQUEST_TYPES[number];
export const ITEM_TYPES = ["product", "accessory", "temporary"] as const;
export type ItemType = typeof ITEM_TYPES[number];
export const MOVEMENT_TYPES = ["stock_in", "stock_out", "transfer", "adjustment"] as const;
export type MovementType = typeof MOVEMENT_TYPES[number];
export type MovementAction = "receive_stock" | "internal_transfer" | "return_to_warehouse" | "sale" | "adjustment";
export type ProductCondition = "new" | "used" | "showroom" | "damaged";
export type ProductSource = "project_balance" | "purchase" | "sample" | "manual_entry";
export type DimensionUnit = "mm" | "cm" | "m";

export interface StockBuckets {
  warehouse_quantity: number;
  dubai_showroom_quantity: number;
  abudhabi_showroom_quantity: number;
  mockup_quantity: number;
  temporary_out_quantity: number;
  sold_quantity: number;
}
export const LOCATION_QUANTITY_COLUMNS = {
  warehouse: "warehouse_quantity", dubai_showroom: "dubai_showroom_quantity",
  abudhabi_showroom: "abudhabi_showroom_quantity", mockup: "mockup_quantity",
  temporary_out: "temporary_out_quantity", sold: "sold_quantity",
} as const satisfies Record<InventoryLocation, keyof StockBuckets>;

interface ProductIdentity {
  id: string;
  brand_id: string;
  category_id: string;
  subcategory_id: string | null;
  custom_category_name: string | null;
  stock_ref: string;
  item_code: string;
  item_name: string;
  model_name: string;
  description: string | null;
  condition: ProductCondition;
  source: ProductSource;
  note: string | null;
  dimension_length: number | null;
  dimension_width: number | null;
  dimension_height: number | null;
  dimension_unit: DimensionUnit | null;
  item_type: ItemType;
  quantity: number;
  created_at: string;
  updated_at: string;
}
export interface InventoryProductRow extends ProductIdentity, StockBuckets {
  low_stock_at: number;
  status: ProductStatus;
  location: string | null;
  is_active: boolean;
  removed_at: string | null;
  removed_by: string | null;
  removal_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
}
export interface InventoryCosts {
  price: number;
  freight_cost: number;
  c_and_f: number;
  transport: number;
  custom_duty: number;
  labour: number;
  vat: number;
  total_cost: number;
}
export interface InventoryProduct extends InventoryProductRow {
  brand_name: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  main_image_url: string | null;
  // Omitted entirely for non-managers and when no cost row exists.
  costs?: InventoryCosts;
}
export interface InventoryProductSummary {
  id: string;
  brand_id: string;
  stock_ref: string;
  item_code: string;
  item_name: string;
  model_name: string;
}
export interface InventoryProductRequestRow extends ProductIdentity {
  requested_status: ProductStatus;
  request_status: RequestStatus;
  submitted_by: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  approved_product_id: string | null;
}
export interface InventoryProductRequest extends InventoryProductRequestRow {
  brand_name: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  submitter_display_name: string | null;
  approved_product: InventoryProductSummary | null;
  costs?: InventoryCosts;
}
export interface InventoryImageRow {
  id: string;
  product_id: string | null;
  product_request_id: string | null;
  storage_bucket: string;
  storage_path: string;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  sort_order: number;
  is_main: boolean;
  alt_text: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface InventoryImage extends InventoryImageRow { signed_url: string | null }
export interface InventoryCategory {
  id: string; parent_id: string | null; name: string; slug: string;
  is_active: boolean; sort_order: number; created_at: string; updated_at: string;
}
export interface InventoryCategoryNode extends InventoryCategory { children: InventoryCategoryNode[] }
export interface InventoryBrand { id: string; name: string }
export interface InventoryMovementRow {
  id: string; product_id: string; movement_type: MovementType; action_type: MovementAction;
  from_location: InventoryLocation | null; to_location: InventoryLocation | null;
  quantity: number; previous_quantity: number; new_quantity: number; note: string | null;
  reference_type: "manual" | "product_request" | "take_item" | "adjustment";
  reference_id: string | null; created_by: string; created_at: string;
}
export interface InventoryMovement extends InventoryMovementRow {
  product: InventoryProductSummary | null;
  actor_display_name: string | null;
}
export interface InventoryMovementRequestRow {
  id: string; product_id: string; request_type: RequestType;
  movement_type: MovementType; action_type: MovementAction;
  from_location: InventoryLocation | null; to_location: InventoryLocation | null;
  quantity: number; note: string | null; request_status: RequestStatus;
  submitted_by: string; submitted_at: string; reviewed_by: string | null;
  reviewed_at: string | null; review_note: string | null; approved_movement_id: string | null;
  created_at: string; updated_at: string;
}
export interface InventoryMovementRequest extends InventoryMovementRequestRow {
  product: InventoryProductSummary | null;
  submitter_display_name: string | null;
}
export interface InventoryProductDetail extends InventoryProduct {
  images: InventoryImage[];
  recent_movements: InventoryMovement[];
}
export interface InventoryPage<T> { items: T[]; total: number; page: number; page_size: number; page_count: number }
export interface InventoryStockSummary {
  product_count: number;
  total_live_quantity: number;
  low_stock_count: number;
  // Quantities per bucket; sold is cumulative and excluded from total_live_quantity.
  location_quantities: Record<InventoryLocation, number>;
}
export interface InventoryOverview extends InventoryStockSummary {
  pending_product_requests: number;
  pending_movement_requests: number;
}

export type ProductSort = "name_asc" | "name_desc" | "newest" | "oldest" | "quantity_asc" | "quantity_desc";
export interface ProductFilters {
  search?: string; brand_id?: string; category_id?: string; subcategory_id?: string;
  status?: ProductStatus; item_type?: ItemType; location?: InventoryLocation;
  active?: boolean | "all"; sort?: ProductSort;
}
export interface RequestFilters {
  request_status?: RequestStatus; submitted_by?: string; request_type?: RequestType; product_id?: string;
  page?: number;
}
export interface ProductRequestFilters extends Omit<RequestFilters, "request_type" | "product_id"> {
  search?: string; brand_id?: string; category_id?: string; subcategory_id?: string; item_type?: ItemType;
}
export interface MovementFilters {
  product_id?: string; created_by?: string; movement_type?: MovementType;
  location?: InventoryLocation; from?: string; to?: string;
}
