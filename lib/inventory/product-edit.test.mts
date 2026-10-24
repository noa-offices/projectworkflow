import assert from "node:assert/strict";
import test from "node:test";
import { buildProductPatch, canUseProductTools, photoSlotsLeft, photoUploadPlan, productEditFormInput, removalNotice, removeReasonError } from "./product-edit";
import { productInput } from "./action-validation";
import { inventoryErrorMessage } from "./action-errors";
import { previewProduct } from "./preview-data";

const product = { ...previewProduct, item_code: "CHR-042", model_name: "Arlo", dimension_length: 60, dimension_width: 50, dimension_height: 90, dimension_unit: "cm" as const, location: "Aisle 4" };
function form(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    brand_id: product.brand_id, category_id: product.category_id, subcategory_id: product.subcategory_id ?? "", custom_category_name: product.custom_category_name ?? "",
    item_type: product.item_type, item_name: product.item_name, item_code: product.item_code ?? "", model_name: product.model_name ?? "", description: product.description ?? "", note: product.note ?? "",
    status: product.status, condition: product.condition, location: product.location ?? "",
    dimension_length: "60", dimension_width: "50", dimension_height: "90", dimension_unit: "cm",
    price: String(product.costs!.price), freight_cost: String(product.costs!.freight_cost), c_and_f: String(product.costs!.c_and_f), transport: String(product.costs!.transport),
    custom_duty: String(product.costs!.custom_duty), labour: String(product.costs!.labour), vat: String(product.costs!.vat),
    stock_ref: "HACK-1", quantity: "999", ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const patchOf = (data: FormData, costsAllowed = true) => buildProductPatch(product, productEditFormInput(data, { costsAllowed, hasLocation: true }));

test("only System Owner and Admin Manager can use the product tools", () => {
  for (const role of ["system_owner", "admin_manager"]) assert.equal(canUseProductTools(role), true);
  for (const role of ["procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff", "unknown", "", null, undefined]) assert.equal(canUseProductTools(role), false);
});
test("an untouched form produces an empty patch", () => assert.deepEqual(patchOf(form()), {}));
test("the patch holds only changed fields", () => {
  assert.deepEqual(patchOf(form({ item_name: "  Arlo chair XL  ", price: "900" })), { item_name: "Arlo chair XL", costs: { price: 900 } });
});
test("blank item code and model name become empty values", () => {
  assert.deepEqual(patchOf(form({ item_code: "  ", model_name: "" })), { item_code: null, model_name: null });
  assert.deepEqual(productInput(patchOf(form({ item_code: "", model_name: "" })), true, true), { item_code: null, model_name: null });
});
test("stock ref and quantity are never sent, even if the form contains them", () => {
  const patch = patchOf(form({ stock_ref: "OTHER", quantity: "1" }));
  assert.equal("stock_ref" in patch, false); assert.equal("quantity" in patch, false);
  const input = productEditFormInput(form(), { costsAllowed: true, hasLocation: true });
  assert.equal("stock_ref" in input, false); assert.equal("quantity" in input, false);
});
test("costs are left out for roles that cannot see them", () => {
  const patch = patchOf(form({ price: "1" }), false);
  assert.equal("costs" in patch, false);
  assert.equal("costs" in productEditFormInput(form(), { costsAllowed: false, hasLocation: true }), false);
});
test("size is sent as a whole set, or cleared as a whole set", () => {
  assert.deepEqual(patchOf(form({ dimension_length: "61" })), { dimension_length: 61, dimension_width: 50, dimension_height: 90, dimension_unit: "cm" });
  assert.deepEqual(patchOf(form({ dimension_length: "", dimension_width: "", dimension_height: "" })), { dimension_length: null, dimension_width: null, dimension_height: null, dimension_unit: null });
});
test("location is only read when the product has one", () => {
  assert.equal("location" in productEditFormInput(form(), { costsAllowed: true, hasLocation: false }), false);
  assert.deepEqual(patchOf(form({ location: "Aisle 5" })), { location: "Aisle 5" });
});
test("photo limit: three in total, new photos take free positions, main only when first", () => {
  assert.equal(photoSlotsLeft(0), 3); assert.equal(photoSlotsLeft(2), 1); assert.equal(photoSlotsLeft(3), 0); assert.equal(photoSlotsLeft(5), 0);
  assert.deepEqual(photoUploadPlan([], 2), [{ sortOrder: 0, isMain: true }, { sortOrder: 1, isMain: false }]);
  assert.deepEqual(photoUploadPlan([{ sort_order: 0 }, { sort_order: 2 }], 1), [{ sortOrder: 1, isMain: false }]);
  assert.deepEqual(photoUploadPlan([{ sort_order: 0 }, { sort_order: 1 }, { sort_order: 2 }], 1), []);
});
test("removing needs a reason", () => {
  for (const reason of ["", "   ", "\n"]) assert.match(removeReasonError(reason)!, /reason/i);
  assert.equal(removeReasonError("Display model retired"), null);
  assert.ok(removeReasonError("x".repeat(1001)));
});
test("remove warns about stock and active reservations in plain words", () => {
  const notice = removalNotice({ quantity: 17, reserved_quantity: 3 });
  assert.equal(notice.warnings.length, 2); assert.match(notice.warnings[0], /17 units in stock/); assert.match(notice.warnings[1], /3 units are held or booked/);
  assert.deepEqual(removalNotice({ quantity: 0, reserved_quantity: 0 }).warnings, []);
  assert.match(removalNotice({ quantity: 1, reserved_quantity: 1 }).warnings.join(" "), /1 unit in stock.*1 unit is held/);
  assert.match(notice.effects.join(" "), /hidden from the Products list/);
});
test("database messages for edit and remove are shown in plain words", () => {
  assert.equal(inventoryErrorMessage({ message: "item code already in use" }), "That item code is already in use.");
  assert.equal(inventoryErrorMessage({ message: "Reason is required" }), "Enter a reason for removing this item.");
  assert.match(inventoryErrorMessage({ message: "Active product not found" })!, /already been removed/);
  assert.match(inventoryErrorMessage({ message: "Invalid product patch field value" })!, /not valid/);
  assert.match(inventoryErrorMessage({ code: "42501", message: "Inventory management permission required" })!, /permission/);
});
