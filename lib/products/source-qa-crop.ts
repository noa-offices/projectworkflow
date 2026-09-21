import { draftModularRows, type ProductTemplateDraft } from "./product-template-draft";
import { baseModelGroupRouteKey } from "./base-model-draft-groups";
import type { SmartReviewedPricingSubgroups } from "./smart-product-row-images";
import { normalizeSourceQaCode, type SourceQaPage } from "./source-qa";

export type SourceCropRect = { x: number; y: number; width: number; height: number };
export type SourceQaTextGeometry = { text: string; normalizedText: string; x: number; y: number; width: number; height: number };
export type SourceQaPdfTextItem = { str: string; transform: number[]; width: number; height: number };
export function sourceQaTextGeometry(items: SourceQaPdfTextItem[]) { return items.filter((item) => item.str.trim() && item.transform.length >= 6).map((item) => ({ text: item.str, normalizedText: normalizeSourceQaCode(item.str), x: item.transform[4], y: item.transform[5], width: item.width, height: item.height })); }
export function sourceQaTextGeometryMatch(items: SourceQaTextGeometry[], query: string) { const normalized = normalizeSourceQaCode(query); if (!normalized) return null; for (let index = 0; index < items.length; index += 1) { const item = items[index]; if (item.normalizedText === normalized) return item; const next = items[index + 1]; if (next && normalizeSourceQaCode(item.text + next.text) === normalized) return { text: item.text + next.text, normalizedText: normalized, x: item.x, y: Math.max(item.y, next.y), width: next.x + next.width - item.x, height: Math.max(item.height, next.height) }; } return null; }
export function sourceQaTextGeometryViewport(geometry: SourceQaTextGeometry, pageHeight: number, scale: number) { return { x: geometry.x * scale, y: (pageHeight - geometry.y - geometry.height) * scale, width: geometry.width * scale, height: geometry.height * scale }; }
export type SourceCropTarget = { id: string; sourceKey: string; rowId: string; label: string; codes: string[]; kind: "Base / Model" | "Category / Matrix" | "Modular" | "Accessory" | "Visual subgroup" };
export function normalizeSourceCrop(rect: SourceCropRect): SourceCropRect { const x2 = rect.x + rect.width; const y2 = rect.y + rect.height; return { x: Math.min(rect.x, x2), y: Math.min(rect.y, y2), width: Math.abs(rect.width), height: Math.abs(rect.height) }; }
export function cropForZoom(rect: SourceCropRect, zoom: number) { return { x: rect.x * zoom, y: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom }; }
export function validSourceCrop(rect: SourceCropRect | null) { return !!rect && rect.width >= 12 && rect.height >= 12; }
/** Scale used to re-render the PDF page for crop export only, so the exported image is sharper than the on-screen preview canvas without slowing down normal viewing/zooming. */
export function exportRenderScale(zoom: number, multiplier = 2, maxScale = 4) { return Math.min(maxScale, Math.max(zoom, zoom * multiplier)); }
/** "Fit width" zoom: the scale that makes the PDF page's native width match the available viewer width, clamped to a sane zoom range. */
export function fitWidthZoom(containerWidth: number, pageWidth: number, min = 0.5, max = 4) { return !containerWidth || !pageWidth ? 1 : Math.min(max, Math.max(min, containerWidth / pageWidth)); }
export function sourceCropSearchPages(pages: SourceQaPage[], query: string) { const code = normalizeSourceQaCode(query); if (!code) return []; return pages.filter((page) => normalizeSourceQaCode(page.text).includes(code)).map((page) => page.pageNumber); }
function rowLabel(row: { id: string; label: string | null; displayName: string | null; supplierCodes: string[] }) { return (row.supplierCodes[0] ?? "No code") + " — " + (row.displayName ?? row.label ?? row.id); }
function rowCodes(row: { supplierCodes: string[]; referenceCodes: string[] }) { return [...row.supplierCodes, ...row.referenceCodes]; }
export function uniqueSourceCropTarget(targets: SourceCropTarget[], code: string) { const normalized = normalizeSourceQaCode(code); const matches = targets.filter((target) => target.codes.some((value) => normalizeSourceQaCode(value) === normalized)); return matches.length === 1 ? matches[0] : null; }
export function selectedSourceCropTargets(targets: SourceCropTarget[], targetIds: Iterable<string>) {
  const selected = new Set(targetIds);
  return targets.filter((target) => selected.delete(target.id));
}
export function mergeSourceCropTargetIds(selectedIds: Iterable<string>, targetIds: Iterable<string>) { return [...new Set([...selectedIds, ...targetIds])]; }
export function removeSourceCropTargetIds(selectedIds: Iterable<string>, targetIds: Iterable<string>) { const removed = new Set(targetIds); return [...new Set(selectedIds)].filter((id) => !removed.has(id)); }
export function existingSourceCropTargets(targets: SourceCropTarget[], targetIds: Iterable<string>, existingTargetIds: ReadonlySet<string>) {
  return selectedSourceCropTargets(targets, targetIds).filter((target) => existingTargetIds.has(target.id));
}
export function nextSourceCropTarget(targets: SourceCropTarget[], currentTargetId: string, existingTargetIds: ReadonlySet<string>, assignedTargetIds: Iterable<string>) {
  const currentIndex = targets.findIndex((target) => target.id === currentTargetId);
  if (currentIndex < 0) return null;
  const assigned = new Set(assignedTargetIds); const sourceKey = targets[currentIndex].sourceKey;
  const eligible = (target: SourceCropTarget) => !existingTargetIds.has(target.id) && !assigned.has(target.id);
  return targets.slice(currentIndex + 1).find((target) => target.sourceKey === sourceKey && eligible(target)) ?? targets.slice(currentIndex + 1).find(eligible) ?? null;
}
export function sourceCropTargets(draft: ProductTemplateDraft, subgroups: SmartReviewedPricingSubgroups = {}): SourceCropTarget[] {
  const rows = [...draft.pricing.baseModelRows.map((row) => ({ id: "base:" + row.id, sourceKey: row.groupId ? baseModelGroupRouteKey(row.groupId) : "base_model:rows", rowId: row.id, label: rowLabel(row), codes: rowCodes(row), kind: "Base / Model" as const })), ...draft.pricing.priceMatrices.flatMap((matrix) => matrix.rows.map((row) => ({ id: "matrix:" + matrix.id + ":" + row.id, sourceKey: "matrix:" + matrix.id, rowId: row.id, label: rowLabel(row), codes: rowCodes(row), kind: "Category / Matrix" as const }))), ...draft.pricing.modularGroups.flatMap((group) => draftModularRows(group).map((row) => ({ id: "modular:" + group.id + ":" + row.id, sourceKey: "modular:" + group.id, rowId: row.id, label: rowLabel(row), codes: rowCodes(row), kind: "Modular" as const }))), ...draft.optionGroups.flatMap((group) => group.items.map((row) => ({ id: "option:" + group.id + ":" + row.id, sourceKey: "option:" + group.id, rowId: row.id, label: rowLabel(row), codes: rowCodes(row), kind: "Accessory" as const })))];
  const visualSubgroups = Object.entries(subgroups).flatMap(([sourceKey, items]) => items.map((item) => ({ id: "subgroup:" + sourceKey + ":" + item.id, sourceKey: "subgroup:" + sourceKey, rowId: item.id, label: "Subgroup — " + item.subgroup_name, codes: [], kind: "Visual subgroup" as const })));
  return [...rows, ...visualSubgroups];
}
