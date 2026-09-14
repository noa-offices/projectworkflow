import type { OriginalImportedJsonSource } from "./original-imported-json-sources";

export const SPEC_ENRICHMENT_DISPLAY_NAME_MAX = 160;
export const SPEC_ENRICHMENT_SPECIFICATION_MAX = 1000;
export type SpecificationEnrichmentRow = { id: string; displayName: string | null; specification: string | null; supplierCodes: string[]; referenceCodes: string[]; dimensions: unknown };
export type SpecificationEnrichmentContext = { templateName: string | null; groupLabel: string | null; rowType: string | null };
export type SpecificationEnrichmentRequest = { row: SpecificationEnrichmentRow; context: SpecificationEnrichmentContext; originalImportedJsonSources: OriginalImportedJsonSource[] };
export type SpecificationEnrichmentResult = { displayNameSuggestion: string | null; specificationSuggestion: string | null };
export type SpecificationEnrichmentActionResult = { ok: true; result: SpecificationEnrichmentResult } | { ok: false; code: "invalid_request" | "no_context" | "not_configured" | "provider_failed"; message: string };
export type BatchSpecificationEnrichmentProviderItem = { targetId: string; currentSpecification: string | null; rowContext: { displayName: string | null; templateName: string | null; groupLabel: string | null; rowType: string | null }; sourceFragment: unknown };
export type BatchSpecificationEnrichmentResultItem = { targetId: string; specificationSuggestion: string | null };
export type BatchSpecificationEnrichmentActionResult =
  | { ok: true; results: BatchSpecificationEnrichmentResultItem[]; skippedTargetIds: string[] }
  | { ok: false; code: "invalid_request" | "not_configured" | "provider_failed"; message: string; results: BatchSpecificationEnrichmentResultItem[]; skippedTargetIds: string[] };

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function suggestion(value: unknown, maximum: number) { if (value === null || value === "") return null; if (typeof value !== "string") return undefined; const trimmed = value.trim(); return !trimmed ? null : trimmed.length <= maximum ? trimmed : undefined; }
export function parseSpecificationEnrichmentResult(value: unknown): SpecificationEnrichmentResult | null {
  if (!record(value) || Object.keys(value).some((key) => !["displayNameSuggestion", "specificationSuggestion"].includes(key))) return null;
  const displayNameSuggestion = suggestion(value.displayNameSuggestion, SPEC_ENRICHMENT_DISPLAY_NAME_MAX); const specificationSuggestion = suggestion(value.specificationSuggestion, SPEC_ENRICHMENT_SPECIFICATION_MAX);
  return displayNameSuggestion === undefined || specificationSuggestion === undefined ? null : { displayNameSuggestion, specificationSuggestion };
}
export function parseBatchSpecificationEnrichmentResult(value: unknown, requestedTargetIds: string[]): BatchSpecificationEnrichmentResultItem[] | null {
  if (!Array.isArray(value) || value.length !== requestedTargetIds.length) return null;
  const requested = new Set(requestedTargetIds);
  const seen = new Set<string>();
  const parsed: BatchSpecificationEnrichmentResultItem[] = [];
  for (const item of value) {
    if (!record(item) || Object.keys(item).some((key) => !["targetId", "specificationSuggestion"].includes(key)) || typeof item.targetId !== "string" || !requested.has(item.targetId) || seen.has(item.targetId)) return null;
    const specificationSuggestion = suggestion(item.specificationSuggestion, SPEC_ENRICHMENT_SPECIFICATION_MAX);
    if (specificationSuggestion === undefined) return null;
    seen.add(item.targetId);
    parsed.push({ targetId: item.targetId, specificationSuggestion });
  }
  return seen.size === requested.size ? parsed : null;
}
export function isSpecificationEnrichmentRequest(value: unknown): value is SpecificationEnrichmentRequest {
  if (!record(value) || !record(value.row) || !record(value.context) || !Array.isArray(value.originalImportedJsonSources)) return false;
  const row = value.row; const context = value.context;
  const shortText = (item: unknown, maximum: number) => item === null || (typeof item === "string" && item.length <= maximum);
  const codes = (items: unknown) => Array.isArray(items) && items.length <= 50 && items.every((item) => typeof item === "string" && item.length <= 200);
  return typeof row.id === "string" && Boolean(row.id.trim()) && row.id.length <= 200
    && shortText(row.displayName, 1000) && shortText(row.specification, 5000)
    && codes(row.supplierCodes) && codes(row.referenceCodes)
    && shortText(context.templateName, 300) && shortText(context.groupLabel, 300) && shortText(context.rowType, 100);
}
