import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupplierUploadProgress } from "./supplier-import-resume";
import { supplierRows, supplierWrite } from "./supplier-price-repository";

const incompleteStatuses = ["uploading", "importing", "failed"];

/** Read-only, through the caller's RLS client: which chunk receipts one source already holds. */
export async function supplierSourceUploadProgress(client: SupabaseClient, sourceId: string): Promise<SupplierUploadProgress> {
  if (typeof sourceId !== "string" || !sourceId) throw Error("Supplier source is required.");
  const source = (await supplierRows<{ id: string; status: string; file_hash: string; expected_rows: number; expected_chunks: number }>(client, "supplier_source_versions", "id,status,file_hash,expected_rows,expected_chunks", { id: sourceId })).at(0);
  if (!source) throw Error("Supplier source unavailable.");
  const chunks = await supplierRows<{ chunk_index: number }>(client, "supplier_source_chunks", "chunk_index", { source_id: sourceId }, "chunk_index");
  return { sourceId: source.id, status: source.status, fileHash: source.file_hash, expectedRows: source.expected_rows, expectedChunks: source.expected_chunks, storedChunks: chunks.map((c) => c.chunk_index) };
}

export type SupplierImportCancelResult = { status: "cancelled" | "already_cancelled"; cleaned: boolean; message: string };

/**
 * Cancels one INCOMPLETE import. Uses only the existing guarded writers: archive_source (row lock; further chunk and finalize writes are
 * then rejected) and purge_archived_supplier_source (System Owner only; deletes this source's own rows and receipts) plus the supported
 * Storage API for the receipt-listed file. Never touches an imported or reviewed source. Repeating it is safe.
 */
export async function cancelIncompleteSupplierImport(client: SupabaseClient, sourceId: string): Promise<SupplierImportCancelResult> {
  if (typeof sourceId !== "string" || !sourceId) throw Error("Supplier source is required.");
  const read = async () => (await supplierRows<{ id: string; status: string; archived_from_status: string | null }>(client, "supplier_source_versions", "id,status,archived_from_status", { id: sourceId })).at(0);
  let source = await read();
  if (source && source.status === "imported") throw Error("This price list finished importing, so it cannot be cancelled. Archive it from the price list history instead.");
  if (source && source.status === "archived" && source.archived_from_status === "imported") throw Error("This is an archived completed import, not an unfinished one.");
  if (source && incompleteStatuses.includes(source.status)) {
    await supplierWrite(client, "archive_source", { source_id: sourceId });
    // The import may have finished between the read and the archive. A completed import is restored, never removed.
    source = await read();
    if (source?.archived_from_status === "imported" || source?.status === "imported") {
      if (source.status === "archived") await supplierWrite(client, "source_unarchive", { source_id: sourceId });
      throw Error("The import finished just now, so it was not cancelled.");
    }
  }
  const purge = await client.rpc("purge_archived_supplier_source", { p_source_id: sourceId, p_confirm: true });
  if (purge.error) {
    if (source && source.status === "archived") return { status: "cancelled", cleaned: false, message: `Import cancelled and blocked from further use. Partial data remains until the System Owner removes it (${purge.error.message}).` };
    // Nothing to clean: an earlier cancellation already removed the source and its file.
    if (!source) return { status: "already_cancelled", cleaned: true, message: "This import was already cancelled." };
    throw Error(purge.error.message);
  }
  const data = purge.data as { storage_paths?: string[]; cleanup_retry?: boolean } | null;
  const paths = data?.storage_paths ?? [];
  if (paths.length) {
    try {
      const removed = await client.storage.from("supplier-price-sources").remove(paths);
      if (removed.error) throw Error(removed.error.message);
      const finish = await client.rpc("finish_supplier_source_file_cleanup", { p_source_id: sourceId });
      if (finish.error) throw Error(finish.error.message);
    } catch (error) {
      return { status: "cancelled", cleaned: false, message: `Import cancelled and its data removed. The uploaded file could not be deleted: ${error instanceof Error ? error.message : "Unknown error"}. Cancel again to retry.` };
    }
  }
  return { status: source ? "cancelled" : "already_cancelled", cleaned: true, message: source ? "Import cancelled. The unfinished data was removed." : "This import was already cancelled." };
}
