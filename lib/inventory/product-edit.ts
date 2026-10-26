import { brandFields } from "./brands";
import { canManageInventory } from "./access";
import { changedProductRequestFields, PRODUCT_COST_FIELDS } from "./product-request-submission";
import type { InventoryProductDetail } from "./types";

/** Edit, photo and remove tools are for System Owner and Admin Manager only. */
export const canUseProductTools = (role: string | null | undefined): boolean => canManageInventory(role);

export const MAX_PRODUCT_PHOTOS = 3;
export const PHOTO_PICKER_TYPES = "image/jpeg,image/png,image/webp";

const blankToNull = (value: FormDataEntryValue | null) => { const text = String(value ?? "").trim(); return text === "" ? null : text; };

/** Reads the edit form. Stock ref and quantity are never read: they are not editable here. */
export function productEditFormInput(data: FormData, options: { costsAllowed: boolean; hasLocation: boolean }): Record<string, unknown> {
  const input: Record<string, unknown> = {
    ...brandFields(data), category_id: data.get("category_id"), subcategory_id: blankToNull(data.get("subcategory_id")),
    custom_category_name: blankToNull(data.get("custom_category_name")), item_type: data.get("item_type"),
    item_name: String(data.get("item_name") ?? "").trim(), item_code: blankToNull(data.get("item_code")), model_name: blankToNull(data.get("model_name")),
    description: blankToNull(data.get("description")), note: blankToNull(data.get("note")),
    status: data.get("status"), condition: data.get("condition"),
  };
  if (options.hasLocation) input.location = blankToNull(data.get("location"));
  const dimensions = ["dimension_length", "dimension_width", "dimension_height"];
  if (dimensions.some(key => String(data.get(key) ?? "").trim())) {
    for (const key of dimensions) input[key] = Number(data.get(key));
    input.dimension_unit = data.get("dimension_unit");
  } else for (const key of [...dimensions, "dimension_unit"]) input[key] = null;
  if (options.costsAllowed) input.costs = Object.fromEntries(PRODUCT_COST_FIELDS.map(key => [key, Number(data.get(key) || 0)]));
  return input;
}

/** Only the fields that differ from the saved product. Empty object means nothing changed. */
export function buildProductPatch(product: InventoryProductDetail, input: Record<string, unknown>): Record<string, unknown> {
  return changedProductRequestFields(product, input);
}

/** Free photo positions (0 to 2) in order. A new photo is main only when the product has no photos. */
export function photoUploadPlan(existing: readonly { sort_order: number }[], uploadedCount: number) {
  const used = new Set(existing.map(photo => photo.sort_order));
  const free = [0, 1, 2].filter(position => !used.has(position));
  return free.slice(0, uploadedCount).map(sortOrder => ({ sortOrder, isMain: existing.length === 0 && sortOrder === 0 }));
}
export const photoSlotsLeft = (count: number): number => Math.max(0, MAX_PRODUCT_PHOTOS - count);

export function removeReasonError(reason: string): string | null {
  const text = reason.trim();
  if (!text) return "Enter a reason for removing this item.";
  if (text.length > 1000) return "Keep the reason under 1000 characters.";
  return null;
}

/** Plain words for what remove_product does: the item is marked inactive; stock, reservations and history are kept. */
export function removalNotice(product: Pick<InventoryProductDetail, "quantity" | "reserved_quantity">): { warnings: string[]; effects: string[] } {
  const warnings: string[] = [];
  if (product.quantity > 0) warnings.push(`This item still has ${product.quantity} ${product.quantity === 1 ? "unit" : "units"} in stock.`);
  if (product.reserved_quantity > 0) warnings.push(`${product.reserved_quantity} ${product.reserved_quantity === 1 ? "unit is" : "units are"} held or booked by active reservations.`);
  return { warnings, effects: [
    "The item is hidden from the Products list and can no longer be edited.",
    "Nothing is deleted. Stock numbers, reservations, photos and history stay on record, and your reason is saved.",
    "Stock is not moved or sold by removing an item.",
  ] };
}
