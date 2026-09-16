import {
  normalizeProductTemplateDraft,
  type ProductTemplateDraftValidationResult,
} from "./product-template-draft";
import { repairJsonSyntax, type SyntaxRepairKind } from "./import-guardian-syntax-repair";

export const MAX_SMART_PRODUCT_JSON_BYTES = 1_500_000;

export type SmartProductJsonImportResult =
  | { kind: "empty" | "oversized" | "invalid_json"; message: string }
  | { kind: "validation"; validation: ProductTemplateDraftValidationResult; repaired?: SyntaxRepairKind[] }
  | { kind: "valid"; validation: ProductTemplateDraftValidationResult; repaired?: SyntaxRepairKind[] };

export function parseSmartProductJsonImport(rawJson: string): SmartProductJsonImportResult {
  if (!rawJson.trim()) {
    return { kind: "empty", message: "Paste JSON before validating." };
  }
  if (new TextEncoder().encode(rawJson).byteLength > MAX_SMART_PRODUCT_JSON_BYTES) {
    return { kind: "oversized", message: "This JSON is too large. Limit one product family import to 1.5 MB." };
  }

  const invalidJsonResult: SmartProductJsonImportResult = { kind: "invalid_json", message: "Invalid JSON. Check that you copied the complete AI response and that it contains only valid JSON." };

  let parsed: unknown;
  let repaired: SyntaxRepairKind[] | undefined;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    // Strict parse failed: attempt deterministic, syntax-only repair (Markdown
    // fences, BOM, invalid "\_" escapes, trailing commas, unescaped inner
    // quotes) and re-parse exactly once. No AI, no commercial-value changes.
    const repair = repairJsonSyntax(rawJson);
    if (!repair.applied.length) return invalidJsonResult;
    try {
      parsed = JSON.parse(repair.text);
      repaired = repair.applied;
    } catch {
      return invalidJsonResult;
    }
  }

  const validation = normalizeProductTemplateDraft(parsed);
  return validation.valid
    ? { kind: "valid", validation, ...(repaired ? { repaired } : {}) }
    : { kind: "validation", validation, ...(repaired ? { repaired } : {}) };
}
