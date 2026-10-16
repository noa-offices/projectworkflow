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
