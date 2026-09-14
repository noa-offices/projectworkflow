"use server";
import { requireProductLibraryManager } from "@/lib/auth";
import { batchSpecificationChunks, flattenBatchSpecificationTargets, prepareBatchSpecificationEnrichment, processSpecificationBatchesSequentially } from "@/lib/products/specification-enrichment-batch";
import { isSpecificationEnrichmentRequest, type BatchSpecificationEnrichmentActionResult, type SpecificationEnrichmentActionResult, type SpecificationEnrichmentRequest } from "@/lib/products/specification-enrichment-contract";
import { enrichSpecificationBatchWithProvider, enrichSpecificationWithProvider, SpecificationEnrichmentProviderError } from "@/lib/products/specification-enrichment-provider.server";
import { matchSpecificationEnrichmentSourceContext } from "@/lib/products/specification-enrichment-source-context";
import { validateOriginalImportedJsonSources, type OriginalImportedJsonSource } from "@/lib/products/original-imported-json-sources";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "@/lib/products/product-template-draft";

export async function runSpecificationEnrichment(request: SpecificationEnrichmentRequest): Promise<SpecificationEnrichmentActionResult> {
  await requireProductLibraryManager();
  if (!isSpecificationEnrichmentRequest(request)) return { ok: false, code: "invalid_request", message: "A valid product row is required." };
  const sources = validateOriginalImportedJsonSources(request.originalImportedJsonSources); if (!sources.valid) return { ok: false, code: "invalid_request", message: sources.message };
  const row = { id: request.row.id, displayName: request.row.displayName, specification: request.row.specification, supplierCodes: [...request.row.supplierCodes], referenceCodes: [...request.row.referenceCodes], dimensions: request.row.dimensions };
  const context = { templateName: request.context.templateName, groupLabel: request.context.groupLabel, rowType: request.context.rowType };
  const matched = matchSpecificationEnrichmentSourceContext(row, context, sources.sources); if (matched.kind === "no_context") return { ok: false, code: "no_context", message: "No reliable source context was found for this row." };
  try { return { ok: true, result: await enrichSpecificationWithProvider({ row, context, sourceFragment: matched.fragment }) }; } catch (error) { const notConfigured = error instanceof SpecificationEnrichmentProviderError && error.kind === "not_configured"; return { ok: false, code: notConfigured ? "not_configured" : "provider_failed", message: notConfigured ? "Specification enrichment is not configured." : error instanceof SpecificationEnrichmentProviderError ? error.message : "Specification enrichment could not be completed." }; }
}

export async function runBatchSpecificationEnrichment(request: { draft: ProductTemplateDraft; originalImportedJsonSources: OriginalImportedJsonSource[] }): Promise<BatchSpecificationEnrichmentActionResult> {
  await requireProductLibraryManager();
  const normalized = normalizeProductTemplateDraft(request?.draft);
  if (!normalized.valid || !normalized.draft) return { ok: false, code: "invalid_request", message: "A valid reviewed product draft is required.", results: [], skippedTargetIds: [] };
  const sources = validateOriginalImportedJsonSources(request.originalImportedJsonSources);
  if (!sources.valid) return { ok: false, code: "invalid_request", message: sources.message, results: [], skippedTargetIds: [] };
  const targets = flattenBatchSpecificationTargets(normalized.draft);
  if (targets.length > 120 || new Set(targets.map((target) => target.targetId)).size !== targets.length) return { ok: false, code: "invalid_request", message: "Specification enrichment targets are invalid.", results: [], skippedTargetIds: [] };

  const { eligible, skippedTargetIds } = prepareBatchSpecificationEnrichment(targets, sources.sources);

  const results: BatchSpecificationEnrichmentActionResult["results"] = [];
  const batches = batchSpecificationChunks(eligible);
  let activeBatchIndex = 0;
  try {
    await processSpecificationBatchesSequentially(batches, async (batch, index) => {
      activeBatchIndex = index;
      results.push(...await enrichSpecificationBatchWithProvider(batch));
    });
  } catch (error) {
    const remaining = batches.slice(activeBatchIndex).flat().map((item) => item.targetId);
    const notConfigured = error instanceof SpecificationEnrichmentProviderError && error.kind === "not_configured";
    return { ok: false, code: notConfigured ? "not_configured" : "provider_failed", message: notConfigured ? "Specification enrichment is not configured." : error instanceof SpecificationEnrichmentProviderError ? error.message : "Specification enrichment could not be completed.", results, skippedTargetIds: [...skippedTargetIds, ...remaining] };
  }
  return { ok: true, results, skippedTargetIds };
}
