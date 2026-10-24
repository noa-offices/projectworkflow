import { productInput } from "./action-validation";
import type { InventoryPhotoUploadResult } from "./photo-upload";
import type { PhotoFileInput, PhotoOwner } from "./action-validation";
import { canManageInventory } from './access';

export const PRODUCT_COST_FIELDS = ["price", "freight_cost", "c_and_f", "transport", "custom_duty", "labour", "vat"] as const;
export function changedProductRequestFields(before: object, after: Record<string, unknown>): Record<string, unknown> {
  const original = before as Record<string, unknown>, edits: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (key === 'costs') {
      const costs = changedProductRequestFields((original.costs as object) ?? {}, value as Record<string, unknown>);
      if (Object.keys(costs).length) edits.costs = costs;
    } else if (JSON.stringify(original[key] ?? null) !== JSON.stringify(value ?? null)) edits[key] = value;
  }
  const dimensionKeys = ['dimension_length','dimension_width','dimension_height','dimension_unit'];
  if (dimensionKeys.some(key => key in edits)) for (const key of dimensionKeys) edits[key] = after[key];
  return edits;
}
export function photoSelectionError(existingCount: number, incoming: readonly Pick<File, "type">[]): string | null {
  if (existingCount + incoming.length > 3) return "Choose up to three photos. Remove a photo before adding more.";
  if (incoming.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) return "Choose JPEG, PNG or WebP photos.";
  return null;
}
export function productRequestFormInput(data: FormData, costsAllowed: boolean): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const key of ["brand_id", "category_id", "custom_category_name", "item_code", "item_name", "model_name", "description", "note", "item_type", "requested_status", "condition", "source"])
    if (data.has(key)) input[key] = data.get(key);
  input.subcategory_id = data.get("subcategory_id") || null;
  input.quantity = Number(data.get("quantity"));
  const locations = ['warehouse','dubai_showroom','abudhabi_showroom','mockup','temporary_out'];
  if (locations.some(key => data.has(`stock_${key}`))) input.initial_stock = Object.fromEntries(locations.map(key => [key,Number(data.get(`stock_${key}`) || 0)]));
  const dimensions = ["dimension_length", "dimension_width", "dimension_height"];
  if (dimensions.some(key => String(data.get(key) ?? "").trim())) {
    for (const key of dimensions) input[key] = Number(data.get(key));
    input.dimension_unit = data.get("dimension_unit");
  } else {
    for (const key of [...dimensions,'dimension_unit']) input[key] = null;
  }
  if (costsAllowed) input.costs = Object.fromEntries(PRODUCT_COST_FIELDS.map(key => [key, Number(data.get(key) || 0)]));
  return productInput(input, costsAllowed, false);
}
type Failure = { ok: false; error: string };
type Dependencies = {
  submit: (input: unknown) => Promise<{ ok: true; requestId: string; productId?: string | null } | Failure>;
  upload: (input: PhotoOwner & { files: File[] }) => Promise<InventoryPhotoUploadResult>;
  register: (input: PhotoOwner & { files: PhotoFileInput[] }) => Promise<({ok:true; registeredCount:number}|Failure) & { failedCount:number }>;
};
export type ProductRequestSubmissionResult = Failure | { ok: true; requestId: string; productId?: string | null; failedCount: number; photoError: string | null };
export function productRequestSuccessHref(result: ProductRequestSubmissionResult, role: string | null): string | null {
  if (!result.ok || !canManageInventory(role) || !result.productId) return null;
  return `/inventory/products/${result.productId}${result.failedCount ? `?photoFailures=${result.failedCount}` : ''}`;
}
/** A created request is retained even when a later photo step fails. */
export async function sendProductRequest(input: unknown, files: File[], deps: Dependencies): Promise<ProductRequestSubmissionResult> {
  const request = await deps.submit(input);
  if (!request.ok) return request;
  const owner: PhotoOwner = request.productId ? {ownerType:'product',ownerId:request.productId} : {ownerType:'request',ownerId:request.requestId};
  let failedCount = 0, photoError: string | null = null;
  try {
    if (files.length) {
      const uploaded = await deps.upload({ ...owner, files });
      failedCount = uploaded.failedCount;
      photoError = uploaded.errors.join(" ") || null;
      if (uploaded.files.length) {
        const registered = await deps.register({ ...owner, files: uploaded.files.map((file, index) => ({ ...file, sortOrder: index, isMain: index === 0 })) });
        if (!registered.ok) { failedCount += uploaded.files.length; photoError = [photoError, registered.error].filter(Boolean).join(" "); }
      }
    }
  } catch { failedCount = files.length; photoError = "Photos could not be attached. Your request was still sent."; }
  return { ok: true, requestId: request.requestId, ...(request.productId ? {productId:request.productId} : {}), failedCount, photoError };
}
