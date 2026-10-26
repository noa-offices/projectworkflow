import { inventoryPhotoError, INVENTORY_PHOTO_TYPES, MAX_INVENTORY_PHOTO_BYTES } from "./photo-limits";
import { ITEM_TYPES, LOCATION_LABELS, PRODUCT_STATUSES, REQUEST_TYPES } from "./types";

export class InventoryInputError extends Error {}
export function invalid(message: string): never { throw new InventoryInputError(message); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Please provide valid inventory details.");
  return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) invalid("Please provide a valid identifier.");
  return value.toLowerCase();
}
export function text(value: unknown, label: string, max: number, required = false): string | null {
  if (value === undefined || value === null) { if (required) invalid(`${label} is required.`); return null; }
  if (typeof value !== "string") invalid(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) invalid(`${label} must be ${max} characters or fewer.`);
  if (!trimmed && required) invalid(`${label} is required.`);
  return trimmed || null;
}
export function code<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) invalid(`Please choose a valid ${label}.`);
  return value as T;
}
export function integer(value: unknown, min = 0, max = 2147483647): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid(`Quantity must be a whole number between ${min} and ${max}.`);
  return value;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid("Please provide a valid active/main setting.");
  return value;
}
const actions = ["receive_stock", "internal_transfer", "return_to_warehouse", "sale", "adjustment"] as const;
const live = ["warehouse", "dubai_showroom", "abudhabi_showroom", "mockup", "temporary_out"] as const;
export function reservationRequestInput(input: Record<string, unknown>, kind: string) {
  const project_id = input.projectId == null || input.projectId === '' ? null : uuid(input.projectId);
  const reference_note = text(input.referenceNote, 'Reference', 2000);
  let expires_at: string | null = null;
  if (input.expiresAt != null && input.expiresAt !== '') {
    if (kind !== 'hold' || typeof input.expiresAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.expiresAt) || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) invalid('Hold until must be in the future and is only allowed for holds.');
    expires_at = new Date(input.expiresAt).toISOString();
  }
  if (kind === 'book' && !project_id && !reference_note) invalid('Book requires a project or reference.');
  if (!['hold','book'].includes(kind) && (project_id || reference_note || expires_at)) invalid('Project, reference and hold until are only allowed for hold/book.');
  return {project_id,reference_note,expires_at};
}
export function movementInput(value: unknown, request = false) {
  const input = object(value), kind = request ? code(input.requestType, REQUEST_TYPES, "request type") : undefined;
  const holdBook = kind === "hold" || kind === "book";
  const action = holdBook ? "internal_transfer" : code(input.actionType, actions, "action type");
  // Supplied codes are validated even when hold/book normalizes them away.
  if (input.actionType !== undefined) code(input.actionType, actions, "action type");
  const location = (value: unknown) => value == null ? null : code(value, Object.keys(LOCATION_LABELS), "location");
  let from = location(input.fromLocation), to = location(input.toLocation);
  if (holdBook) { from = null; to = null; }
  else if (action === "receive_stock" || action === "adjustment") { from = null; to = "warehouse"; }
  else {
    from = code(from, live, "source location");
    if (action === "sale") to = "sold";
    else {
      to = code(to, live, "destination location");
      if (from === to) invalid("Choose different source and destination locations.");
      if (action === "return_to_warehouse" && to !== "warehouse") invalid("Returns must go to Warehouse.");
    }
  }
  return { product_id: uuid(input.productId), ...(kind ? { request_type: kind } : {}), action_type: action,
    from_location: from, to_location: to, quantity: integer(input.quantity, action === "adjustment" ? 0 : 1), note: text(input.note, "Note", 2000), ...(kind ? reservationRequestInput(input,kind) : {}) };
}
export function fulfilReservationInput(value: unknown) {
  const input = object(value), reservation_id = uuid(input.reservationId);
  const action_type = code(input.actionType, ['sale','internal_transfer'], 'fulfilment action');
  const movement = movementInput({...input, productId:reservation_id,actionType:action_type,quantity:1});
  return {reservation_id,action_type,from_location:movement.from_location,to_location:movement.to_location,note:movement.note};
}
function decimal(value: unknown, min = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > 9999999999.99 || Math.abs(Math.round(value * 100) - value * 100) > 0.0001) invalid("Amounts and dimensions must be valid numbers with at most two decimal places.");
  return value;
}
export function initialStockInput(value: unknown, quantity?: number): Record<string, number> {
  const input = object(value), stock: Record<string, number> = {};
  for (const [key, count] of Object.entries(input)) {
    code(key, live, 'initial stock location');
    stock[key] = integer(count);
  }
  const total = Object.values(stock).reduce((sum, count) => sum + count, 0);
  if (total < 1 || total > 2147483647 || (quantity !== undefined && total !== quantity)) invalid('Initial stock total must equal quantity, with at least one location above zero.');
  return stock;
}
export function productInput(value: unknown, costsAllowed: boolean, patch: boolean, review = false): Record<string, unknown> {
  const input = object(value), result: Record<string, unknown> = {};
  const requiredText = { item_name: 200, ...(patch && !review ? { stock_ref: 100 } : {}) };
  for (const [key, max] of Object.entries(requiredText)) if (!patch || key in input) result[key] = text(input[key], key.replaceAll("_", " "), max, true);
  for (const [key,max] of Object.entries({item_code:100,model_name:200})) {
    if (!patch || key in input) result[key] = text(input[key],key.replaceAll('_',' '),max);
  }
  for (const [key, max] of Object.entries({ custom_category_name: 200, description: 5000, note: 2000, ...(patch && !review ? { location: 200 } : {}) })) {
    if (key in input) result[key] = text(input[key], key, max);
  }
  if (!patch || "category_id" in input) result.category_id = uuid(input.category_id);
  for (const key of ["brand_id", "local_brand_id"]) if (!patch || key in input) result[key] = input[key] == null || input[key] === "" ? null : uuid(input[key]);
  if (result.brand_id && result.local_brand_id) invalid("Choose only one brand.");
  if ("subcategory_id" in input) result.subcategory_id = input.subcategory_id === null ? null : uuid(input.subcategory_id);
  for (const [key, choices] of Object.entries({
    [patch && !review ? "status" : "requested_status"]: PRODUCT_STATUSES,
    condition: ["new", "used", "showroom", "damaged"], item_type: ITEM_TYPES,
    ...(!patch || review ? { source: ["project_balance", "purchase", "sample", "manual_entry"] } : {}),
  })) if (key in input) result[key] = code(input[key], choices, key);
  if (!patch || (review && 'quantity' in input)) result.quantity = integer(input.quantity, 1);
  if ((!patch || review) && 'initial_stock' in input) result.initial_stock = initialStockInput(input.initial_stock, result.quantity as number | undefined);
  const dimensionKeys = ["dimension_length", "dimension_width", "dimension_height", "dimension_unit"];
  if (dimensionKeys.some(key => key in input)) {
    if (!dimensionKeys.every(key => key in input)) invalid("Provide all dimensions and their unit, or clear all four.");
    if (dimensionKeys.every(key => input[key] === null)) for (const key of dimensionKeys) result[key] = null;
    else {
      for (const key of dimensionKeys.slice(0, 3)) result[key] = decimal(input[key], 0.01);
      result.dimension_unit = code(input.dimension_unit, ["mm", "cm", "m"], "dimension unit");
    }
  }
  // Do not even parse costs supplied by a non-manager.
  if (costsAllowed && "costs" in input) {
    const source = object(input.costs), costs: Record<string, number> = {};
    for (const key of ["price", "freight_cost", "c_and_f", "transport", "custom_duty", "labour", "vat"]) if (key in source) costs[key] = decimal(source[key]);
    result.costs = costs;
  }
  if (patch && !review && !Object.keys(result).length) invalid("Provide at least one product detail to update.");
  return result;
}
export function categoryInput(value: unknown, patch: boolean) {
  const input = object(value), result: { name?: string; slug?: string; parent_id?: string | null; sort_order?: number } = {};
  if (!patch || "name" in input) {
    result.name = text(input.name, "Category name", 200, true)!;
    const base = result.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100).replace(/-$/g, "");
    result.slug = base || `category-${crypto.randomUUID()}`;
  }
  if (!patch || "parentId" in input) result.parent_id = input.parentId == null ? null : uuid(input.parentId);
  if ("sortOrder" in input) result.sort_order = integer(input.sortOrder, 0, 100000);
  if (patch && !Object.keys(result).length) invalid("Provide a category detail to update.");
  return result;
}
export type PhotoFileInput = { path: string; contentType: string; sizeBytes: number; sortOrder: number; isMain: boolean };
export type PhotoOwner = { ownerType: "product" | "request"; ownerId: string };
export function photoInput(value: unknown): PhotoOwner & { files: PhotoFileInput[] } {
  const input = object(value), ownerType = code(input.ownerType, ["product", "request"], "photo owner"), ownerId = uuid(input.ownerId);
  if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > 3) invalid("Register between one and three photos at a time.");
  const prefix = `${ownerType === "product" ? "products" : "requests"}/${ownerId}/`;
  const files = input.files.map(value => {
    const file = object(value), path = text(file.path, "Photo path", 250, true)!;
    const problem=inventoryPhotoError(file.sizeBytes,file.contentType); if(problem) invalid(problem);
    const contentType = code(file.contentType, INVENTORY_PHOTO_TYPES, "photo format");
    const suffix = path.slice(prefix.length);
    if (!path.startsWith(prefix) || !/^[A-Za-z0-9_-][A-Za-z0-9_-]*\.(jpg|jpeg|png|webp)$/.test(suffix)) invalid("Photo path does not match its owner.");
    const extension = suffix.split(".").at(-1);
    if (!(contentType === "image/jpeg" ? ["jpg", "jpeg"] : [contentType.split("/")[1]]).includes(extension!)) invalid("Photo extension does not match its format.");
    return { path, contentType, sizeBytes: integer(file.sizeBytes, 1, MAX_INVENTORY_PHOTO_BYTES), sortOrder: integer(file.sortOrder, 0, 2), isMain: boolean(file.isMain) };
  });
  if (new Set(files.map(file => file.path)).size !== files.length) invalid("Each uploaded photo must be different.");
  return { ownerType, ownerId, files };
}
export function validatePhotoSet(existing: { sort_order: number; is_main: boolean }[], files: PhotoFileInput[]) {
  const combined = [...existing.map(row => ({ sort: row.sort_order, main: row.is_main })), ...files.map(row => ({ sort: row.sortOrder, main: row.isMain }))];
  if (combined.length > 3) invalid("An item or request can have at most three photos.");
  if (new Set(combined.map(row => row.sort)).size !== combined.length) invalid("Photo sort positions must be unique.");
  if (combined.filter(row => row.main).length !== 1 || combined.some(row => row.main && row.sort !== 0)) invalid("Exactly one photo must be main, in position zero.");
}
