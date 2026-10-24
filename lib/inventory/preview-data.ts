import { summarizeStock } from "./mapping";
import type { InventoryBrand, InventoryCategoryNode, InventoryOverview, InventoryProduct, InventoryProductDetail } from "./types";

const created = "2026-10-23T06:30:00.000Z";
export const previewBrands: InventoryBrand[] = [{ id: "11111111-1111-4111-8111-111111111111", name: "Nora Office" }];
export const previewCategories: InventoryCategoryNode[] = [{
  id: "22222222-2222-4222-8222-222222222222", parent_id: null, name: "Chairs", slug: "chairs", is_active: true, sort_order: 0, created_at: created, updated_at: created,
  children: [{ id: "33333333-3333-4333-8333-333333333333", parent_id: "22222222-2222-4222-8222-222222222222", name: "Task chairs", slug: "task-chairs", is_active: true, sort_order: 0, created_at: created, updated_at: created, children: [] }],
}];
export const previewProduct: InventoryProductDetail = {
  id: "44444444-4444-4444-8444-444444444444", brand_id: previewBrands[0].id, category_id: previewCategories[0].id, subcategory_id: previewCategories[0].children[0].id,
  custom_category_name: null, stock_ref: "02-0001", item_code: "CHR-042", item_name: "Arlo ergonomic task chair", model_name: "Arlo Mid Back",
  description: "A comfortable task chair with a breathable back, adjustable arms and a five-star base. Charcoal upholstery with a dark graphite frame.",
  condition: "new", source: "purchase", note: "Keep the original packaging for showroom transfers.",
  dimension_length: 65, dimension_width: 62, dimension_height: 110, dimension_unit: "cm", item_type: "product",
  reserved_quantity: 3, available_quantity: 14,
  quantity: 17, warehouse_quantity: 12, dubai_showroom_quantity: 3, abudhabi_showroom_quantity: 2, mockup_quantity: 0, temporary_out_quantity: 0, sold_quantity: 8,
  low_stock_at: 5, status: "available", location: null, is_active: true, removed_at: null, removed_by: null, removal_reason: null, created_by: null, updated_by: null,
  created_at: created, updated_at: created, brand_name: "Nora Office", category_name: "Chairs", subcategory_name: "Task chairs", main_image_url: "/dev/inventory-chair.svg",
  reservations: [{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",product_id:"44444444-4444-4444-8444-444444444444",kind:"book",quantity:3,status:"active",project_id:null,project_label:"PR-2026-042 - Marina office - Acme Interiors",reference_note:"Client installation",expires_at:null,note:"Keep these chairs together for the project delivery.",created_by:"77777777-7777-4777-8777-777777777777",created_at:created,source_request_id:null,released_by:null,released_at:null,release_note:null,fulfilled_movement_id:null,creator_display_name:"Alex Morgan"}],
  images: [0, 1, 2].map(index => ({ id: `photo-${index}`, product_id: "44444444-4444-4444-8444-444444444444", product_request_id: null, storage_bucket: "inventory-images", storage_path: `products/sample/${index}.jpg`, file_name: null, content_type: "image/jpeg", size_bytes: 1000, sort_order: index, is_main: index === 0, alt_text: ["Chair front view", "Chair in showroom", "Chair upholstery detail"][index], uploaded_by: null, created_at: created, updated_at: created, signed_url: `/dev/inventory-chair.svg?view=${index}` })),
  recent_movements: [{ id: "movement-1", product_id: "44444444-4444-4444-8444-444444444444", movement_type: "transfer", action_type: "internal_transfer", from_location: "warehouse", to_location: "dubai_showroom", quantity: 3, previous_quantity: 17, new_quantity: 17, note: null, reference_type: "manual", reference_id: null, created_by: "sample-user", created_at: created, product: null, actor_display_name: "Alex Morgan" },
    { id: "movement-2", product_id: "44444444-4444-4444-8444-444444444444", movement_type: "stock_in", action_type: "receive_stock", from_location: null, to_location: "warehouse", quantity: 17, previous_quantity: 0, new_quantity: 17, note: null, reference_type: "manual", reference_id: null, created_by: "sample-user", created_at: "2026-10-22T08:00:00.000Z", product: null, actor_display_name: null }],
  costs: { price: 850, freight_cost: 35, c_and_f: 20, transport: 15, custom_duty: 10, labour: 5, vat: 46.75, total_cost: 981.75 },
};
export const previewProducts: InventoryProduct[] = [previewProduct,
  { ...previewProduct, id: "55555555-5555-4555-8555-555555555555", item_name: "Arlo meeting chair", item_code: null, model_name: null, stock_ref: "02-0002", quantity: 4, reserved_quantity: 1, available_quantity: 3, warehouse_quantity: 3, dubai_showroom_quantity: 1, abudhabi_showroom_quantity: 0, sold_quantity: 3, low_stock_at: 5, status: "hold", main_image_url: null },
  { ...previewProduct, id: "66666666-6666-4666-8666-666666666666", item_name: "Arlo visitor chair with upholstered arm pads", item_code: "CHR-044", stock_ref: "02-0003", quantity: 22, reserved_quantity: 0, available_quantity: 22, warehouse_quantity: 20, dubai_showroom_quantity: 0, abudhabi_showroom_quantity: 2, sold_quantity: 1, status: "showroom" },
  { ...previewProduct, id: "77777777-7777-4777-8777-777777777771", item_type: "accessory", item_name: "Arlo replacement arm pads", item_code: "ARM-001", model_name: null, stock_ref: "02-0004", quantity: 12, reserved_quantity: 0, available_quantity: 12, warehouse_quantity: 12, dubai_showroom_quantity: 0, abudhabi_showroom_quantity: 0, sold_quantity: 0 },
  { ...previewProduct, id: "77777777-7777-4777-8777-777777777772", item_type: "accessory", item_name: "Arlo castor set", item_code: null, model_name: null, stock_ref: "02-0005", quantity: 6, reserved_quantity: 0, available_quantity: 6, warehouse_quantity: 6, dubai_showroom_quantity: 0, abudhabi_showroom_quantity: 0, sold_quantity: 0, main_image_url: null },
  { ...previewProduct, id: "88888888-8888-4888-8888-888888888881", item_type: "temporary", item_name: "Arlo sample task chair", item_code: "SAMPLE-001", model_name: "Arlo Mid Back", stock_ref: "02-0006", quantity: 2, reserved_quantity: 0, available_quantity: 2, warehouse_quantity: 1, dubai_showroom_quantity: 1, abudhabi_showroom_quantity: 0, sold_quantity: 0, source: "sample" },
  { ...previewProduct, id: "88888888-8888-4888-8888-888888888882", item_type: "temporary", item_name: "Arlo loan meeting chair", item_code: null, model_name: null, stock_ref: "02-0007", quantity: 1, reserved_quantity: 0, available_quantity: 1, warehouse_quantity: 0, dubai_showroom_quantity: 1, abudhabi_showroom_quantity: 0, sold_quantity: 0, source: "sample", main_image_url: null },
];
export const previewOverview: InventoryOverview = { reserved_quantity: previewProducts.reduce((sum, product) => sum + product.reserved_quantity, 0), ...summarizeStock(previewProducts), pending_product_requests: 3, pending_movement_requests: 5 };
