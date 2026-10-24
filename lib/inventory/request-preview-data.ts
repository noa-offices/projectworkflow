import { previewProduct } from "./preview-data";
import type { InventoryMovementRequest, InventoryProductRequest } from "./types";

export const previewRequestUserId = "77777777-7777-4777-8777-777777777777";
const other = "88888888-8888-4888-8888-888888888888";
const created = "2026-10-23T06:30:00.000Z";
const productRequest: InventoryProductRequest = {
  id: "99999999-9999-4999-8999-999999999991", brand_id: previewProduct.brand_id,
  category_id: previewProduct.category_id, subcategory_id: previewProduct.subcategory_id,
  custom_category_name: null, stock_ref: "WH-2026-0051", item_code: "CHR-051",
  item_name: "Arlo ergonomic task chair", model_name: "Arlo Mid Back", description: previewProduct.description,
  condition: "new", source: "purchase", note: "New delivery received. Please check the item details before adding to stock.",
  dimension_length: 65, dimension_width: 62, dimension_height: 110, dimension_unit: "cm", item_type: "product",
  initial_stock: null,
  quantity: 6, created_at: created, updated_at: created, requested_status: "available", request_status: "pending_review",
  submitted_by: previewRequestUserId, submitted_at: created, reviewed_by: null, reviewed_at: null, review_note: null,
  approved_product_id: null, brand_name: "Nora Office", category_name: "Chairs", subcategory_name: "Task chairs",
  submitter_display_name: "Alex Morgan", approved_product: null,
};
export const previewProductRequests: InventoryProductRequest[] = [
  productRequest,
  { ...productRequest, id: "99999999-9999-4999-8999-999999999992", item_name: "Arlo meeting chair", item_code: "CHR-052", submitted_by: other, submitter_display_name: null, quantity: 3, note: "Meeting room delivery.", request_status: "approved", reviewed_by: other, reviewed_at: created, review_note: "Checked and added to inventory.", approved_product_id: previewProduct.id },
  { ...productRequest, id: "99999999-9999-4999-8999-999999999993", item_name: "Arlo visitor chair", item_code: "CHR-053", request_status: "rejected", reviewed_by: other, reviewed_at: created, review_note: "Please confirm the item code and submit a new request." },
];
const movement: InventoryMovementRequest = {
  project_id: null, project_label: null, reference_note: null, expires_at: null, approved_reservation_id: null,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", product_id: previewProduct.id, request_type: "move", movement_type: "transfer", action_type: "internal_transfer",
  from_location: "warehouse", to_location: "dubai_showroom", quantity: 2, note: "For the new showroom display.", request_status: "pending_review",
  submitted_by: previewRequestUserId, submitted_at: created, reviewed_by: null, reviewed_at: null, review_note: null, approved_movement_id: null,
  created_at: created, updated_at: created, product: { id: previewProduct.id, item_name: previewProduct.item_name, item_code: previewProduct.item_code, stock_ref: previewProduct.stock_ref, model_name: previewProduct.model_name, brand_id: previewProduct.brand_id },
  submitter_display_name: "Alex Morgan",
};
export const previewMovementRequests: InventoryMovementRequest[] = [
  movement,
  { ...movement, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", request_type: "hold", action_type: "internal_transfer", submitted_by: other, submitter_display_name: "Sam Taylor", from_location: null, to_location: null, quantity: 1, note: "Hold for the client presentation." },
  { ...movement, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", request_type: "take", action_type: "sale", movement_type: "stock_out", to_location: "sold", request_status: "approved", reviewed_by: other, reviewed_at: created, review_note: "Confirmed for delivery.", submitted_by: other, submitter_display_name: null },
  { ...movement, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", request_type: "book", action_type: "internal_transfer", from_location: null, to_location: null, request_status: "rejected", reviewed_by: other, reviewed_at: created, review_note: "Please confirm the required delivery date." },
];
