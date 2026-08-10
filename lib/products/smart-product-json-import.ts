import {
  normalizeProductTemplateDraft,
  type ProductTemplateDraftValidationResult,
} from "./product-template-draft";

export const MAX_SMART_PRODUCT_JSON_BYTES = 1_500_000;

export type SmartProductJsonImportResult =
  | { kind: "empty" | "oversized" | "invalid_json"; message: string }
  | { kind: "validation"; validation: ProductTemplateDraftValidationResult }
  | { kind: "valid"; validation: ProductTemplateDraftValidationResult };

export function parseSmartProductJsonImport(rawJson: string): SmartProductJsonImportResult {
  if (!rawJson.trim()) {
    return { kind: "empty", message: "Paste JSON before validating." };
  }
  if (new TextEncoder().encode(rawJson).byteLength > MAX_SMART_PRODUCT_JSON_BYTES) {
    return { kind: "oversized", message: "This JSON is too large. Limit one product family import to 1.5 MB." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { kind: "invalid_json", message: "Invalid JSON. Check that you copied the complete AI response and that it contains only valid JSON." };
  }

  const validation = normalizeProductTemplateDraft(parsed);
  return validation.valid ? { kind: "valid", validation } : { kind: "validation", validation };
}
