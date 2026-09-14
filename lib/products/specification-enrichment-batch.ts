import type { OriginalImportedJsonSource } from "./original-imported-json-sources";
import type { ProductTemplateDraft, ProductTemplateDraftMatrixRow, ProductTemplateDraftPricedRow } from "./product-template-draft";
import type { SpecificationEnrichmentContext, SpecificationEnrichmentRow } from "./specification-enrichment-contract";
import type { BatchSpecificationEnrichmentProviderItem } from "./specification-enrichment-contract";
import { matchSpecificationEnrichmentSourceContext } from "./specification-enrichment-source-context";

export const SPECIFICATION_ENRICHMENT_BATCH_SIZE = 6;
const MAX_MATCHED_SOURCE_FRAGMENT_BYTES = 32 * 1024;
export type BatchSpecificationTargetKind = "base_model" | "workstation" | "matrix" | "modular" | "option";
export type BatchSpecificationTarget = {
  targetId: string;
  kind: BatchSpecificationTargetKind;
  currentSpecification: string | null;
  label: string;
  row: SpecificationEnrichmentRow;
  context: SpecificationEnrichmentContext;
};
export type BatchSpecificationSuggestion = { targetId: string; specificationSuggestion: string | null };

const encoded = (value: string) => encodeURIComponent(value);
const targetId = {
  baseModel: (rowId: string) => `baseModel:${encoded(rowId)}`,
  workstation: (rowId: string) => `workstation:${encoded(rowId)}`,
  matrix: (matrixId: string, rowId: string) => `matrix:${encoded(matrixId)}:${encoded(rowId)}`,
  modular: (groupId: string, rowId: string) => `modular:${encoded(groupId)}:${encoded(rowId)}`,
  option: (groupId: string, rowId: string) => `option:${encoded(groupId)}:${encoded(rowId)}`,
};

function target(targetIdValue: string, kind: BatchSpecificationTargetKind, row: ProductTemplateDraftPricedRow | ProductTemplateDraftMatrixRow, context: SpecificationEnrichmentContext): BatchSpecificationTarget {
  return {
    targetId: targetIdValue,
    kind,
    currentSpecification: row.specification,
    label: row.displayName ?? row.label ?? row.supplierCodes[0] ?? row.id,
    row: { id: row.id, displayName: row.displayName, specification: row.specification, supplierCodes: row.supplierCodes, referenceCodes: row.referenceCodes, dimensions: row.dimensions },
    context,
  };
}

export function flattenBatchSpecificationTargets(draft: ProductTemplateDraft): BatchSpecificationTarget[] {
  const templateName = draft.template.templateName;
  return [
    ...draft.pricing.baseModelRows.map((row) => target(targetId.baseModel(row.id), "base_model", row, { templateName, groupLabel: "Base / Model Pricing", rowType: "base_model" })),
    ...draft.pricing.workstationRows.map((row) => target(targetId.workstation(row.id), "workstation", row, { templateName, groupLabel: "Workstation Pricing", rowType: "workstation" })),
    ...draft.pricing.priceMatrices.flatMap((matrix) => matrix.rows.map((row) => target(targetId.matrix(matrix.id, row.id), "matrix", row, { templateName, groupLabel: matrix.label, rowType: "category_matrix" }))),
    ...draft.pricing.modularGroups.flatMap((group) => group.matrix.rows.map((row) => target(targetId.modular(group.id, row.id), "modular", row, { templateName, groupLabel: group.label ?? group.matrix.label, rowType: "modular" }))),
    ...draft.optionGroups.flatMap((group) => group.items.map((row) => target(targetId.option(group.id, row.id), "option", row, { templateName, groupLabel: group.label, rowType: "accessory" }))),
  ];
}

export function batchSpecificationChunks<T>(items: T[], size = SPECIFICATION_ENRICHMENT_BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > SPECIFICATION_ENRICHMENT_BATCH_SIZE) throw new Error("Invalid specification enrichment batch size.");
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export async function processSpecificationBatchesSequentially<T>(batches: T[][], process: (batch: T[], index: number) => Promise<void>) {
  for (let index = 0; index < batches.length; index += 1) await process(batches[index], index);
}

export function prepareBatchSpecificationEnrichment(targets: BatchSpecificationTarget[], sources: OriginalImportedJsonSource[]) {
  const skippedTargetIds: string[] = [];
  const eligible: BatchSpecificationEnrichmentProviderItem[] = [];
  targets.forEach((target) => {
    const matched = matchSpecificationEnrichmentSourceContext(target.row, target.context, sources);
    if (matched.kind === "no_context") { skippedTargetIds.push(target.targetId); return; }
    if (new TextEncoder().encode(JSON.stringify(matched.fragment)).byteLength > MAX_MATCHED_SOURCE_FRAGMENT_BYTES) { skippedTargetIds.push(target.targetId); return; }
    eligible.push({
      targetId: target.targetId,
      currentSpecification: target.currentSpecification,
      rowContext: { displayName: target.row.displayName, templateName: target.context.templateName, groupLabel: target.context.groupLabel, rowType: target.context.rowType },
      sourceFragment: matched.fragment,
    });
  });
  return { eligible, skippedTargetIds };
}

function changed(current: string | null, suggestion: string | null) {
  return suggestion !== null && suggestion.trim() !== (current ?? "").trim();
}

export function applyBatchSpecificationSuggestions(draft: ProductTemplateDraft, suggestions: BatchSpecificationSuggestion[]): ProductTemplateDraft {
  const values = new Map(suggestions.filter((item) => item.specificationSuggestion !== null).map((item) => [item.targetId, item.specificationSuggestion]));
  const patch = <T extends { specification: string | null }>(row: T, id: string): T => {
    const suggestion = values.get(id);
    return suggestion !== undefined && changed(row.specification, suggestion) ? { ...row, specification: suggestion } : row;
  };
  return {
    ...draft,
    pricing: {
      ...draft.pricing,
      baseModelRows: draft.pricing.baseModelRows.map((row) => patch(row, targetId.baseModel(row.id))),
      workstationRows: draft.pricing.workstationRows.map((row) => patch(row, targetId.workstation(row.id))),
      priceMatrices: draft.pricing.priceMatrices.map((matrix) => ({ ...matrix, rows: matrix.rows.map((row) => patch(row, targetId.matrix(matrix.id, row.id))) })),
      modularGroups: draft.pricing.modularGroups.map((group) => ({ ...group, matrix: { ...group.matrix, rows: group.matrix.rows.map((row) => patch(row, targetId.modular(group.id, row.id))) } })),
    },
    optionGroups: draft.optionGroups.map((group) => ({ ...group, items: group.items.map((row) => patch(row, targetId.option(group.id, row.id))) })),
  };
}

function fingerprintText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

export function batchSpecificationFingerprint(draft: ProductTemplateDraft, sources: OriginalImportedJsonSource[]) {
  return fingerprintText(JSON.stringify({
    targets: flattenBatchSpecificationTargets(draft).map(({ targetId: id, row, context }) => ({ id, row, context })),
    sources,
  }));
}

export function summarizeBatchSpecificationSuggestions(targets: BatchSpecificationTarget[], suggestions: BatchSpecificationSuggestion[], skippedTargetIds: string[]) {
  const current = new Map(targets.map((item) => [item.targetId, item.currentSpecification]));
  const changedItems = suggestions.filter((item) => changed(current.get(item.targetId) ?? null, item.specificationSuggestion));
  return { changed: changedItems.length, unchanged: suggestions.length - changedItems.length, skipped: skippedTargetIds.length, changedItems };
}
