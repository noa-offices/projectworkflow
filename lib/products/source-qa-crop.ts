import type { ProductTemplateDraft } from "./product-template-draft";
import type { SmartReviewedPricingSubgroups } from "./smart-product-row-images";
import { normalizeSourceQaCode, type SourceQaPage } from "./source-qa";

export type SourceCropRect = { x: number; y: number; width: number; height: number };
export type SourceCropTarget = { id: string; sourceKey: string; rowId: string; label: string; codes: string[]; kind: "Base / Model" | "Category / Matrix" | "Modular" | "Accessory" | "Visual subgroup" };
export function normalizeSourceCrop(rect: SourceCropRect): SourceCropRect { const x2 = rect.x + rect.width; const y2 = rect.y + rect.height; return { x: Math.min(rect.x, x2), y: Math.min(rect.y, y2), width: Math.abs(rect.width), height: Math.abs(rect.height) }; }
export function cropForZoom(rect: SourceCropRect, zoom: number) { return { x: rect.x * zoom, y: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom }; }
export function validSourceCrop(rect: SourceCropRect | null) { return !!rect && rect.width >= 12 && rect.height >= 12; }
export function sourceCropSearchPages(pages: SourceQaPage[], query: string) { const code = normalizeSourceQaCode(query); if (!code) return []; return pages.filter((page) => normalizeSourceQaCode(page.text).includes(code)).map((page) => page.pageNumber); }
function rowLabel(row: { id: string; label: string | null; displayName: string | null; supplierCodes: string[] }) { return (row.supplierCodes[0] ?? "No code") + " — " + (row.displayName ?? row.label ?? row.id); }
function rowCodes(row: { supplierCodes: string[]; referenceCodes: string[] }) { return [...row.supplierCodes, ...row.referenceCodes]; }
export function uniqueSourceCropTarget(targets: SourceCropTarget[], code: string) { const normalized = normalizeSourceQaCode(code); const matches = targets.filter((target) => target.codes.some((value) => normalizeSourceQaCode(value) === normalized)); return matches.length === 1 ? matches[0] : null; }
export function selectedSourceCropTargets(targets: SourceCropTarget[], targetIds: Iterable<string>) {
  const selected = new Set(targetIds);
  return targets.filter((target) => selected.delete(target.id));
}
export function existingSourceCropTargets(targets: SourceCropTarget[], targetIds: Iterable<string>, existingTargetIds: ReadonlySet<string>) {
  return selectedSourceCropTargets(targets, targetIds).filter((target) => existingTargetIds.has(target.id));
}
export function sourceCropTargets(draft: ProductTemplateDraft, subgroups: SmartReviewedPricingSubgroups = {}): SourceCropTarget[] {
  const rows = [...draft.pricing.baseModelRows.map((row) => ({ id: "base:" + row.id, sourceKey: "base_model:rows", rowId: row.id, label: rowLabel(row), codes: rowCodes(row), kind: "Base / Model" as const })), ...draft.pricing.priceMatrices.flatMap((matrix) => matrix.rows.map((row) => ({ id: "matrix:" + matrix.id + ":" + row.id, sourceKey: "matrix:" + matrix.id, rowId: row.id, label: rowLabel(row), codes: rowCodes(row), kind: "Category / Matrix" as const }))), ...draft.pricing.modularGroups.flatMap((group) => group.matrix.rows.map((row) => ({ id: "modular:" + group.id + ":" + row.id, sourceKey: "modular:" + group.id, rowId: row.id, label: rowLabel(row), codes: rowCodes(row), kind: "Modular" as const }))), ...draft.optionGroups.flatMap((group) => group.items.map((row) => ({ id: "option:" + group.id + ":" + row.id, sourceKey: "option:" + group.id, rowId: row.id, label: rowLabel(row), codes: rowCodes(row), kind: "Accessory" as const })))];
  const visualSubgroups = Object.entries(subgroups).flatMap(([sourceKey, items]) => items.map((item) => ({ id: "subgroup:" + sourceKey + ":" + item.id, sourceKey: "subgroup:" + sourceKey, rowId: item.id, label: "Subgroup — " + item.subgroup_name, codes: [], kind: "Visual subgroup" as const })));
  return [...rows, ...visualSubgroups];
}
