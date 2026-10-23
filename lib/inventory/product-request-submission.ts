import { productInput } from "./action-validation";
import type { InventoryPhotoUploadResult } from "./photo-upload";
import type { PhotoFileInput } from "./action-validation";

export const PRODUCT_COST_FIELDS = ["price", "freight_cost", "c_and_f", "transport", "custom_duty", "labour", "vat"] as const;
export function photoSelectionError(existingCount: number, incoming: readonly Pick<File, "type">[]): string | null {
  if (existingCount + incoming.length > 3) return "Choose up to three photos. Remove a photo before adding more.";
  if (incoming.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) return "Choose JPEG, PNG or WebP photos.";
  return null;
}
export function productRequestFormInput(data: FormData, costsAllowed: boolean): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const key of ["brand_id", "category_id", "stock_ref", "item_code", "item_name", "model_name", "description", "note", "item_type", "requested_status", "condition", "source"])
    if (data.has(key)) input[key] = data.get(key);
  input.subcategory_id = data.get("subcategory_id") || null;
  input.quantity = Number(data.get("quantity"));
  const dimensions = ["dimension_length", "dimension_width", "dimension_height"];
  if (dimensions.some(key => String(data.get(key) ?? "").trim())) {
    for (const key of dimensions) input[key] = Number(data.get(key));
    input.dimension_unit = data.get("dimension_unit");
  }
  if (costsAllowed) input.costs = Object.fromEntries(PRODUCT_COST_FIELDS.map(key => [key, Number(data.get(key) || 0)]));
  return productInput(input, costsAllowed, false);
}
type Failure = { ok: false; error: string };
type Dependencies = {
  submit: (input: unknown) => Promise<{ ok: true; requestId: string } | Failure>;
  upload: (input: { ownerType: "request"; ownerId: string; files: File[] }) => Promise<InventoryPhotoUploadResult>;
  register: (input: { ownerType: "request"; ownerId: string; files: PhotoFileInput[] }) => Promise<({ok:true; registeredCount:number}|Failure) & { failedCount:number }>;
};
export type ProductRequestSubmissionResult = Failure | { ok: true; requestId: string; failedCount: number; photoError: string | null };
/** A created request is retained even when a later photo step fails. */
export async function sendProductRequest(input: unknown, files: File[], deps: Dependencies): Promise<ProductRequestSubmissionResult> {
  const request = await deps.submit(input);
  if (!request.ok) return request;
  let failedCount = 0, photoError: string | null = null;
  try {
    if (files.length) {
      const uploaded = await deps.upload({ ownerType: "request", ownerId: request.requestId, files });
      failedCount = uploaded.failedCount;
      photoError = uploaded.errors.join(" ") || null;
      if (uploaded.files.length) {
        const registered = await deps.register({ ownerType: "request", ownerId: request.requestId, files: uploaded.files.map((file, index) => ({ ...file, sortOrder: index, isMain: index === 0 })) });
        if (!registered.ok) { failedCount += uploaded.files.length; photoError = [photoError, registered.error].filter(Boolean).join(" "); }
      }
    }
  } catch { failedCount = files.length; photoError = "Photos could not be attached. Your request was still sent."; }
  return { ok: true, requestId: request.requestId, failedCount, photoError };
}
