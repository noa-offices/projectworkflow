import { isValidShortDimension } from "./ai-clean-text-checks";
import type { ProductTemplateDraft } from "./product-template-draft";
import { flattenBatchSpecificationTargets } from "./specification-enrichment-batch";

// Pure logic for "Shorten dimensions with AI". Only dimensions.rawText is ever read or changed.
export const DIMENSION_CALL_MAX = 20;
export type DimensionTarget = { targetId: string; label: string; text: string };
export type DimensionSuggestion = { targetId: string; dimension: string };
export type DimensionUndoEntry = { targetId: string; before: string; after: string };
export type DimensionReviewEntry = { targetId: string; original: string; value: string; selected: boolean };

/** Rows with a dimension text that is not already in the short format. Rows without a text are skipped (numbers alone have no W/D/H meaning). */
export function buildDimensionTargets(draft: ProductTemplateDraft): DimensionTarget[] {
  return flattenBatchSpecificationTargets(draft).flatMap((target) => {
    const text = (target.row.dimensions as { rawText?: string | null } | null)?.rawText?.trim();
    return text && !isValidShortDimension(text, text) ? [{ targetId: target.targetId, label: target.label, text }] : [];
  });
}
export function chunkDimensionTargets<T>(items: T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / DIMENSION_CALL_MAX) }, (_, index) => items.slice(index * DIMENSION_CALL_MAX, (index + 1) * DIMENSION_CALL_MAX));
}
/** Compares the target ids and texts only, so editing another field does not make a review stale. */
export function dimensionFingerprint(draft: ProductTemplateDraft): string {
  return JSON.stringify(buildDimensionTargets(draft).map((target) => [target.targetId, target.text]));
}

/** Code decides: keep only known, unique, non-null, changed results that pass the dimension check. */
export function validateDimensionResults(items: { targetId: string; text: string }[], results: { targetId: string; dimension: string | null }[]): DimensionSuggestion[] {
  const originals = new Map(items.map((item) => [item.targetId, item.text]));
  const seen = new Set<string>();
  return results.flatMap((result) => {
    const original = originals.get(result.targetId);
    const candidate = result.dimension?.trim();
    if (original === undefined || !candidate || seen.has(result.targetId)) return [];
    seen.add(result.targetId);
    return candidate !== original.trim() && isValidShortDimension(original, candidate) ? [{ targetId: result.targetId, dimension: candidate }] : [];
  });
}
/** Strict parse of the provider answer: exactly one { targetId, dimension } per requested id. */
export function parseDimensionShorteningResult(value: unknown, requested: string[]): { targetId: string; dimension: string | null }[] | null {
  if (!Array.isArray(value) || value.length !== requested.length) return null;
  const wanted = new Set(requested), seen = new Set<string>();
  const parsed: { targetId: string; dimension: string | null }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Object.keys(item).some((key) => key !== "targetId" && key !== "dimension")) return null;
    const { targetId, dimension } = item as { targetId?: unknown; dimension?: unknown };
    if (typeof targetId !== "string" || !wanted.has(targetId) || seen.has(targetId) || !(dimension === null || typeof dimension === "string")) return null;
    seen.add(targetId); parsed.push({ targetId, dimension });
  }
  return parsed;
}
/** Selected review rows whose (possibly edited) text still passes the check. */
export function acceptableDimensionPatches(entries: DimensionReviewEntry[]): DimensionSuggestion[] {
  return entries.filter((entry) => entry.selected && isValidShortDimension(entry.original, entry.value)).map((entry) => ({ targetId: entry.targetId, dimension: entry.value.trim() }));
}

// Same ids as the specification helper (checked by a test), so one row has one id everywhere.
const id = (value: string) => encodeURIComponent(value);
export type Row = { id: string; dimensions: { rawText: string | null } | null };
export function mapRows(draft: ProductTemplateDraft, change: (row: Row, targetId: string) => Row): ProductTemplateDraft {
  const map = <T extends Row>(rows: T[], targetId: (rowId: string) => string) => rows.map((row) => change(row, targetId(row.id)) as T);
  return {
    ...draft,
    pricing: {
      ...draft.pricing,
      baseModelRows: map(draft.pricing.baseModelRows, (rowId) => `baseModel:${id(rowId)}`),
      workstationRows: map(draft.pricing.workstationRows, (rowId) => `workstation:${id(rowId)}`),
      priceMatrices: draft.pricing.priceMatrices.map((matrix) => ({ ...matrix, rows: map(matrix.rows, (rowId) => `matrix:${id(matrix.id)}:${id(rowId)}`) })),
      modularGroups: draft.pricing.modularGroups.map((group) => group.matrix
        ? { ...group, matrix: { ...group.matrix, rows: map(group.matrix.rows, (rowId) => `modular:${id(group.id)}:${id(rowId)}`) } }
        : { ...group, directRows: map(group.directRows ?? [], (rowId) => `modular:${id(group.id)}:${id(rowId)}`) }),
    },
    optionGroups: draft.optionGroups.map((group) => ({ ...group, items: map(group.items, (rowId) => `option:${id(group.id)}:${id(rowId)}`) })),
  };
}
const withText = (row: Row, rawText: string): Row => ({ ...row, dimensions: { ...row.dimensions!, rawText } });

export function applyDimensionPatches(draft: ProductTemplateDraft, patches: DimensionSuggestion[]): { draft: ProductTemplateDraft; undo: DimensionUndoEntry[] } {
  const values = new Map(patches.map((patch) => [patch.targetId, patch.dimension])), undo: DimensionUndoEntry[] = [];
  const next = mapRows(draft, (row, targetId) => {
    const after = values.get(targetId), before = row.dimensions?.rawText;
    if (after === undefined || !before || before === after) return row;
    undo.push({ targetId, before, after });
    return withText(row, after);
  });
  return { draft: next, undo };
}
/** Restores the old text only where the row still holds the shortened text. */
export function undoDimensionPatches(draft: ProductTemplateDraft, entries: DimensionUndoEntry[]): { draft: ProductTemplateDraft; restored: number; kept: number } {
  const byId = new Map(entries.map((entry) => [entry.targetId, entry])), done = new Set<string>();
  const next = mapRows(draft, (row, targetId) => {
    const entry = byId.get(targetId);
    if (!entry || row.dimensions?.rawText !== entry.after) return row;
    done.add(targetId);
    return withText(row, entry.before);
  });
  return { draft: next, restored: done.size, kept: entries.length - done.size };
}
