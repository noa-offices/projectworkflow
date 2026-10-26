import type { InventoryAttribution } from "./attribution";
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
export const STOCK_FILTERS = ["live", "reserved"] as const;
export type StockFilter = typeof STOCK_FILTERS[number];
export const STOCK_FILTER_LABELS: Record<StockFilter, string> = { live: "In stock", reserved: "Reserved" };
export type ProductTypeCounts = Record<"all" | ItemType, number>;
export const MOVEMENT_TYPES = ["stock_in", "stock_out", "transfer", "adjustment"] as const;
export type MovementType = typeof MOVEMENT_TYPES[number];
export const MOVEMENT_ACTIONS = ["receive_stock", "internal_transfer", "return_to_warehouse", "sale", "adjustment"] as const;
export type MovementAction = typeof MOVEMENT_ACTIONS[number];
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
  brand_id: string | null;
  local_brand_id?: string | null;
  category_id: string;
  subcategory_id: string | null;
  custom_category_name: string | null;
  stock_ref: string | null;
  item_code: string | null;
  item_name: string;
  model_name: string | null;
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
  stock_ref: string;
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
  reserved_quantity: number;
  available_quantity: number;
  brand_name: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  main_image_url: string | null;
  // Omitted entirely for non-managers and when no cost row exists.
  costs?: InventoryCosts;
}
export interface InventoryProductSummary {
  brand_name?: string | null;
  id: string;
  brand_id: string | null;
  local_brand_id?: string | null;
  stock_ref: string;
  item_code: string | null;
  item_name: string;
  model_name: string | null;
}
export interface InventoryProductRequestRow extends ProductIdentity {
  initial_stock: Partial<Record<Exclude<InventoryLocation, 'sold'>, number>> | null;
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
  reviewer_display_name: string | null;
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
export interface InventoryBrand { id: string; name: string; code?: string; kind?: "public" | "local" }
export interface InventoryMovementRow {
  id: string; product_id: string; movement_type: MovementType; action_type: MovementAction;
  from_location: InventoryLocation | null; to_location: InventoryLocation | null;
  quantity: number; previous_quantity: number; new_quantity: number; note: string | null;
  reference_type: "manual" | "product_request" | "take_item" | "adjustment";
  reference_id: string | null; created_by: string; created_at: string;
}
export interface InventoryMovementLink { kind: "request" | "reservation" | "product_request"; id: string }
export interface InventoryMovement extends InventoryMovementRow {
  product: InventoryProductSummary | null;
  actor_display_name: string | null;
  /** Requested by / Approved by, or who recorded it directly. */
  attribution?: InventoryAttribution;
  // Set by the manager movement history only.
  main_image_url?: string | null;
  linked?: InventoryMovementLink | null;
}
/** Product choice on the Move screen. Never carries costs. */
export interface MovementPickerProduct extends StockBuckets {
  id: string; item_name: string; stock_ref: string | null; item_code: string | null; model_name: string | null;
  quantity: number; reserved_quantity: number; available_quantity: number; main_image_url: string | null;
}
export interface InventoryCategoryOverview extends InventoryCategoryNode { item_count: number; children: InventoryCategoryOverview[] }
export interface InventoryProjectOption { id: string; label: string }
export interface InventoryReservationRow {
  id: string; product_id: string; kind: "hold" | "book"; quantity: number;
  status: "active" | "released" | "fulfilled"; project_id: string | null; project_label: string | null;
  reference_note: string | null; expires_at: string | null; note: string | null;
  created_by: string; created_at: string; source_request_id: string | null;
  released_by: string | null; released_at: string | null; release_note: string | null; fulfilled_movement_id: string | null;
}
export interface InventoryReservation extends InventoryReservationRow { creator_display_name: string | null }
export interface InventoryMovementRequestRow {
  project_id: string | null; project_label: string | null; reference_note: string | null;
  expires_at: string | null; approved_reservation_id: string | null;
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
  reviewer_display_name: string | null;
}
export interface InventoryProductDetail extends InventoryProduct {
  reservations: InventoryReservation[];
  images: InventoryImage[];
  recent_movements: InventoryMovement[];
}
export interface InventoryPage<T> { items: T[]; total: number; page: number; page_size: number; page_count: number }
export interface InventoryStockSummary {
  // Active products with at least 1 live unit (sold excluded).
  product_count: number;
  total_live_quantity: number;
  // Quantities per bucket; sold is cumulative and excluded from total_live_quantity.
  location_quantities: Record<InventoryLocation, number>;
  // Active products with more than 0 units in each bucket (sold: products sold).
  location_product_counts: Record<InventoryLocation, number>;
  // Live products (as product_count) split by item type.
  item_type_counts: Record<ItemType, number>;
}
export interface InventoryOverview extends InventoryStockSummary {
  reserved_quantity: number;
  reserved_product_count: number;
  pending_product_requests: number;
  pending_movement_requests: number;
}

export interface InventoryActivityEntry {
  id: string;
  product_id: string | null;
  item_name: string;
  display_name: string | null;
  created_at: string;
  attribution?: InventoryAttribution;
}
export interface InventoryOverviewActivity {
  pending_products: InventoryActivityEntry[];
  pending_movements: InventoryActivityEntry[];
  recent_products: InventoryActivityEntry[];
}

export type ProductSort = "name_asc" | "name_desc" | "newest" | "oldest" | "quantity_asc" | "quantity_desc";
export interface ProductFilters {
  search?: string; brand_id?: string; category_id?: string; subcategory_id?: string;
  status?: ProductStatus; item_type?: ItemType; location?: InventoryLocation; stock?: StockFilter;
  active?: boolean | "all"; sort?: ProductSort;
}
export interface RequestFilters {
  search?: string;
  request_status?: RequestStatus; submitted_by?: string; request_type?: RequestType; product_id?: string;
  page?: number;
}
export interface ProductRequestFilters extends Omit<RequestFilters, "request_type" | "product_id"> {
  search?: string; brand_id?: string; category_id?: string; subcategory_id?: string; item_type?: ItemType;
}
export interface MovementFilters {
  product_id?: string; created_by?: string; movement_type?: MovementType; action_type?: MovementAction;
  search?: string; person?: string;
  location?: InventoryLocation; from?: string; to?: string;
}
