import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";
import { MAX_MATCHED_SOURCE_FRAGMENT_BYTES, type BatchSpecificationTarget } from "./specification-enrichment-batch";
import type { BatchSpecificationEnrichmentProviderItem } from "./specification-enrichment-contract";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Only the enrichment action consumes this copy; never use it as an editor/apply draft. */
export function specificationEnrichmentValidationCopy(input: unknown): unknown {
  if (!record(input) || !record(input.pricing) || !Array.isArray(input.pricing.baseModelRows)) return input;
  return { ...input, pricing: { ...input.pricing, baseModelRows: input.pricing.baseModelRows.map((row) => {
    if (!record(row) || row.groupId !== LEGACY_BASE_MODEL_GROUP_ID) return row;
    const copy = { ...row };
    delete copy.groupId;
    return copy;
  }) } };
}

/** Called only with targets from the server-normalized draft. Never accepts client fragments. */
export function prepareSavedSpecificationEnrichment(targets: BatchSpecificationTarget[]) {
  const eligible: BatchSpecificationEnrichmentProviderItem[] = [];
  const skippedTargetIds: string[] = [];
  for (const target of targets) {
    // Saved mode cleans existing wording; it cannot create a specification from identity alone.
    if (!target.currentSpecification?.trim()) { skippedTargetIds.push(target.targetId); continue; }
    const dimension = record(target.row.dimensions) ? target.row.dimensions : null;
    const sourceFragment = {
      source: "saved_data",
      row: {
        name: target.row.displayName ?? target.label,
        supplierCodes: [...target.row.supplierCodes],
        dimensions: dimension ? { width: dimension.width, depth: dimension.depth, height: dimension.height, diameter: dimension.diameter, unit: dimension.unit, rawText: dimension.rawText } : null,
        specification: target.currentSpecification,
      },
      context: { templateName: target.context.templateName, groupLabel: target.context.groupLabel },
    };
    if (new TextEncoder().encode(JSON.stringify(sourceFragment)).byteLength > MAX_MATCHED_SOURCE_FRAGMENT_BYTES) { skippedTargetIds.push(target.targetId); continue; }
    eligible.push({ targetId: target.targetId, currentSpecification: target.currentSpecification, rowContext: { ...target.context, displayName: target.row.displayName }, sourceFragment });
  }
  return { eligible, skippedTargetIds };
}
