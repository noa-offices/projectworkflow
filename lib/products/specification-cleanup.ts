import { buildAccessoryNameList, isSeatingRow, isWordSubset } from "./ai-clean-text-checks";
import { mapRows, type Row } from "./dimension-shortening";
import type { ProductTemplateDraft } from "./product-template-draft";
import { flattenBatchSpecificationTargets } from "./specification-enrichment-batch";

// Pure logic for "Clean specification with AI" (seating rows only). Only row.specification is ever read or changed.
export type SpecificationMode = "seating" | "accessory_only";
export type SpecificationTarget = { targetId: string; label: string; text: string; mode: SpecificationMode };
export type SpecificationSuggestion = { targetId: string; specification: string };
export type SpecificationUndoEntry = { targetId: string; before: string; after: string };
export type SpecificationReviewEntry = { targetId: string; original: string; value: string; selected: boolean };
type SpecRow = Row & { specification: string | null };

/** Every non-accessory row that has a specification. Seating rows are fully cleaned; all others only lose phrases covered by an accessory. */
export function buildSpecificationTargets(draft: ProductTemplateDraft): SpecificationTarget[] {
  return flattenBatchSpecificationTargets(draft).flatMap((target) => {
    const text = target.currentSpecification?.trim();
    if (!text || target.kind === "option") return [];
    const mode: SpecificationMode = isSeatingRow({ groupLabel: target.context.groupLabel, displayName: target.row.displayName ?? target.label }) ? "seating" : "accessory_only";
    return [{ targetId: target.targetId, label: target.label, text, mode }];
  });
}
/** The one accessory list sent with every call: names and codes only. In edit mode the draft already holds the saved accessory pricing. */
export const buildSpecificationAccessoryNames = (draft: ProductTemplateDraft): string[] => buildAccessoryNameList(draft.optionGroups);
/** Stale when a target text or the accessory list changed; other fields do not matter. */
export function specificationFingerprint(draft: ProductTemplateDraft): string {
  return JSON.stringify([buildSpecificationTargets(draft).map((target) => [target.targetId, target.text]), buildSpecificationAccessoryNames(draft)]);
}

/** Code decides: keep only known, unique results whose words all come from the original (isWordSubset also drops empty and equal ones). */
export function validateSpecificationResults(items: { targetId: string; text: string }[], results: { targetId: string; specification: string | null }[]): SpecificationSuggestion[] {
  const originals = new Map(items.map((item) => [item.targetId, item.text])), seen = new Set<string>();
  return results.flatMap((result) => {
    const original = originals.get(result.targetId), candidate = result.specification?.trim();
    if (original === undefined || !candidate || seen.has(result.targetId)) return [];
    seen.add(result.targetId);
    return isWordSubset(original, candidate) ? [{ targetId: result.targetId, specification: candidate }] : [];
  });
}
/** Strict parse of the provider answer: exactly one { targetId, specification } per requested id. */
export function parseSpecificationCleanupResult(value: unknown, requested: string[]): { targetId: string; specification: string | null }[] | null {
  if (!Array.isArray(value) || value.length !== requested.length) return null;
  const wanted = new Set(requested), seen = new Set<string>(), parsed: { targetId: string; specification: string | null }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Object.keys(item).some((key) => key !== "targetId" && key !== "specification")) return null;
    const { targetId, specification } = item as { targetId?: unknown; specification?: unknown };
    if (typeof targetId !== "string" || !wanted.has(targetId) || seen.has(targetId) || !(specification === null || typeof specification === "string")) return null;
    seen.add(targetId); parsed.push({ targetId, specification });
  }
  return parsed;
}
export function acceptableSpecificationPatches(entries: SpecificationReviewEntry[]): SpecificationSuggestion[] {
  return entries.filter((entry) => entry.selected && isWordSubset(entry.original, entry.value)).map((entry) => ({ targetId: entry.targetId, specification: entry.value.trim() }));
}

const withSpecification = (row: Row, specification: string): Row => ({ ...row, specification }) as SpecRow;
export function applySpecificationPatches(draft: ProductTemplateDraft, patches: SpecificationSuggestion[]): { draft: ProductTemplateDraft; undo: SpecificationUndoEntry[] } {
  const values = new Map(patches.map((patch) => [patch.targetId, patch.specification])), undo: SpecificationUndoEntry[] = [];
  const next = mapRows(draft, (row, targetId) => {
    const after = values.get(targetId), before = (row as SpecRow).specification;
    if (after === undefined || !before || before === after) return row;
    undo.push({ targetId, before, after });
    return withSpecification(row, after);
  });
  return { draft: next, undo };
}
/** Restores the old text only where the row still holds the cleaned text. */
export function undoSpecificationPatches(draft: ProductTemplateDraft, entries: SpecificationUndoEntry[]): { draft: ProductTemplateDraft; restored: number; kept: number } {
  const byId = new Map(entries.map((entry) => [entry.targetId, entry])), done = new Set<string>();
  const next = mapRows(draft, (row, targetId) => {
    const entry = byId.get(targetId);
    if (!entry || (row as SpecRow).specification !== entry.after) return row;
    done.add(targetId);
    return withSpecification(row, entry.before);
  });
  return { draft: next, restored: done.size, kept: entries.length - done.size };
}

// ---- speed: small batches (same size as the specification enrichment helper), a few at the same time ----
export const SPECIFICATION_CLEANUP_BATCH_SIZE = 6;
export const SPECIFICATION_CLEANUP_PARALLEL = 3;
export function chunkSpecificationTargets<T>(items: T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / SPECIFICATION_CLEANUP_BATCH_SIZE) }, (_, index) => items.slice(index * SPECIFICATION_CLEANUP_BATCH_SIZE, (index + 1) * SPECIFICATION_CLEANUP_BATCH_SIZE));
}
/** Runs the batches with at most `limit` at the same time. Results keep the batch order; a batch that was never started stays undefined (after cancel). `run` should not throw. */
export async function runInBatches<B, R>(batches: readonly B[], limit: number, run: (batch: B, index: number) => Promise<R>, cancelled: () => boolean = () => false): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(batches.length).fill(undefined);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, batches.length) }, async () => {
    while (next < batches.length && !cancelled()) {
      const index = next++;
      results[index] = await run(batches[index], index);
    }
  }));
  return results;
}
