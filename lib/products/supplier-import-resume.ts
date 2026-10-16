import type { RawSupplierRow } from "./supplier-price-contracts";
export type SupplierUploadProgress = { sourceId: string; status: string; fileHash: string; expectedRows: number; expectedChunks: number; storedChunks: number[] };

/**
 * Which chunk indexes still need uploading. The source keeps its original chunk geometry: the same file, row count and chunk count are
 * required, otherwise the import cannot safely resume. Stored chunks are skipped; the database still validates every chunk it receives.
 */
export function chunksToUpload(progress: SupplierUploadProgress, file: { fileHash: string; expectedRows: number; chunkCount: number }): number[] {
  if (!["uploading", "importing"].includes(progress.status)) throw Error(progress.status === "imported" ? "This price list is already imported." : `This import cannot be resumed (${progress.status}).`);
  if (progress.fileHash !== file.fileHash) throw Error("This is a different file from the unfinished import. Cancel the unfinished import first.");
  if (progress.expectedRows !== file.expectedRows || progress.expectedChunks !== file.chunkCount) throw Error("The unfinished import was split differently from this file. Cancel it and import again.");
  const stored = new Set(progress.storedChunks);
  if ([...stored].some((index) => !Number.isInteger(index) || index < 0 || index >= file.chunkCount)) throw Error("The unfinished import holds unexpected parts. Cancel it and import again.");
  return Array.from({ length: file.chunkCount }, (_, index) => index).filter((index) => !stored.has(index));
}

export type SupplierUploadPhase = "Uploading" | "Finalizing" | "Complete";
export type SupplierUploadDeps = {
  storeFile: (path: string) => Promise<void>; attachFile: (sourceId: string, path: string) => Promise<void>;
  status: (sourceId: string) => Promise<SupplierUploadProgress>; uploadChunk: (sourceId: string, index: number, rows: RawSupplierRow[]) => Promise<unknown>;
  finalize: (sourceId: string, maxCells?: number) => Promise<{ done: boolean; remaining_codes: number; status?: string }>;
  /** Optional bounded compaction of staging payloads before the last finalize step; { unavailable } when the database function is not deployed. */
  compact?: (sourceId: string) => Promise<{ remaining: number; unavailable?: boolean }>;
  onPhase: (phase: SupplierUploadPhase, progress: { done: number; total: number } | null) => void; onMessage: (text: string) => void;
};
/** The one upload path for a new import and for Resume: stores the original file, uploads only the parts the source lacks, then finalizes. */
export async function runSupplierImportUpload(deps: SupplierUploadDeps, p: { sourceId: string; brandId: string; hash: string; sourceType: string; rowCount: number; chunks: RawSupplierRow[][] }) {
  const path = `${p.brandId}/${p.sourceId}/${p.hash}.${p.sourceType}`;
  await deps.storeFile(path); await deps.attachFile(p.sourceId, path);
  const pending = chunksToUpload(await deps.status(p.sourceId), { fileHash: p.hash, expectedRows: p.rowCount, chunkCount: p.chunks.length });
  let done = p.chunks.length - pending.length; deps.onPhase("Uploading", { done, total: p.chunks.length });
  for (const index of pending) { deps.onMessage(`Uploading part ${index + 1} of ${p.chunks.length}. Do not close this page.`); await deps.uploadChunk(p.sourceId, index, p.chunks[index]); done++; deps.onPhase("Uploading", { done, total: p.chunks.length }); }
  await finalizeSupplierImport(deps, p.sourceId);
}

export const FINALIZE_START_CELLS = 2000, FINALIZE_MIN_CELLS = 500, FINALIZE_MAX_CELLS = 20000;
const isTimeout = (error: unknown) => /statement timeout|canceling statement/i.test(error instanceof Error ? error.message : String(error));
/**
 * Finalization in bounded, resumable steps. Each database step is idempotent (identities are inserted on conflict do nothing, whole codes only),
 * so a step that times out is rolled back and simply retried with a smaller budget; the budget grows again while steps stay fast.
 * Imported is reported only when the database says so. Safe to call again after any interruption: that is "Resume Finalization".
 */
export async function finalizeSupplierImport(deps: SupplierUploadDeps, sourceId: string, now: () => number = Date.now) {
  deps.onPhase("Finalizing", null);
  // Payload compaction is moved out of the last step into small steps. Best effort: if it is unavailable or fails, the last step still compacts.
  if (deps.compact) {
    try { for (let guard = 0; guard < 200; guard++) { const compacted = await deps.compact(sourceId); if (compacted.unavailable || compacted.remaining <= 0) break; deps.onMessage(`Tidying temporary import data (${compacted.remaining} parts left). Do not close this page.`); } }
    catch { /* the final step compacts whatever is left */ }
  }
  let budget = FINALIZE_START_CELLS, timeouts = 0, step = 0;
  for (;;) {
    const started = now();
    try {
      const progress = await deps.finalize(sourceId, budget); step++;
      if (progress.done) {
        if (progress.status !== undefined && progress.status !== "imported") throw Error("Finalization finished but the database did not confirm the imported status. Resume Finalization.");
        deps.onPhase("Complete", null); return;
      }
      const elapsed = now() - started; timeouts = 0;
      budget = elapsed < 2500 ? Math.min(FINALIZE_MAX_CELLS, budget * 2) : elapsed > 5000 ? Math.max(FINALIZE_MIN_CELLS, Math.floor(budget / 2)) : budget;
      deps.onMessage(`Preparing the price list (step ${step}, ${progress.remaining_codes} codes left). Do not close this page.`);
    } catch (error) {
      if (!isTimeout(error) || budget <= FINALIZE_MIN_CELLS || ++timeouts > 6) throw Error(`${error instanceof Error ? error.message : "Finalization failed"} — nothing was lost. Use Resume Finalization to continue.`);
      budget = Math.max(FINALIZE_MIN_CELLS, Math.floor(budget / 2));
    }
  }
}

/**
 * The definition an import links to. "New price list" creates one definition per genuinely new list: a retry reuses the definition of the
 * unfinished import of the same file, or the one already created for this name, instead of creating another.
 */
export async function resolveImportDefinition(p: { definitionId: string; newName: string; fileHash: string; incomplete: Array<{ fileHash: string; definitionId: string | null }>; created: { name: string; id: string } | null; create: () => Promise<string> }): Promise<{ id: string; created: { name: string; id: string } | null }> {
  if (p.definitionId !== "new") return { id: p.definitionId, created: p.created };
  const existing = p.incomplete.find((item) => item.fileHash === p.fileHash && item.definitionId)?.definitionId;
  if (existing) return { id: existing, created: p.created };
  if (p.created && p.created.name === p.newName) return { id: p.created.id, created: p.created };
  const id = await p.create();
  return { id, created: { name: p.newName, id } };
}
