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

export type SupplierImportCancelResult = { status: "cancelled" | "already_cancelled"; cleaned: boolean; /** More bounded cleanup calls are needed (call continueIncompleteSupplierCleanup again). */ more: boolean; remaining: number; message: string };

/**
 * One bounded cleanup step for an ARCHIVED, UNFINISHED import (purge_incomplete_supplier_source_step: at most a few thousand rows per call,
 * System Owner only, exact source id, review history excluded). Call repeatedly while `more`. When the source row is finally gone, the
 * receipt-listed Storage file is removed through the Storage API. A non-owner cannot purge; the source stays archived and blocked.
 */
export async function continueIncompleteSupplierCleanup(client: SupabaseClient, sourceId: string): Promise<SupplierImportCancelResult> {
  if (typeof sourceId !== "string" || !sourceId) throw Error("Supplier source is required.");
  const step = await client.rpc("purge_incomplete_supplier_source_step", { p_source_id: sourceId, p_confirm: true });
  if (step.error) {
    if (/unavailable/i.test(step.error.message)) return { status: "already_cancelled", cleaned: true, more: false, remaining: 0, message: "This import was already cancelled." };
    if (/System Owner|permission|privilege/i.test(step.error.message) || step.error.code === "42501") return { status: "cancelled", cleaned: false, more: false, remaining: 0, message: "Import cancelled and blocked from further use. The System Owner removes the partial data from the price list history." };
    throw Error(step.error.message);
  }
  const data = step.data as { done?: boolean; remaining?: number; storage_paths?: string[] } | null;
  if (!data?.done) return { status: "cancelled", cleaned: false, more: true, remaining: data?.remaining ?? 0, message: `Removing partial data… ${(data?.remaining ?? 0).toLocaleString("en-US")} records left.` };
  const paths = data.storage_paths ?? [];
  if (paths.length) {
    try {
      const removed = await client.storage.from("supplier-price-sources").remove(paths);
      if (removed.error) throw Error(removed.error.message);
      const finish = await client.rpc("finish_supplier_source_file_cleanup", { p_source_id: sourceId });
      if (finish.error) throw Error(finish.error.message);
    } catch (error) {
      return { status: "cancelled", cleaned: false, more: false, remaining: 0, message: `Import cancelled and its data removed. The uploaded file could not be deleted: ${error instanceof Error ? error.message : "Unknown error"}. Cancel again to retry.` };
    }
  }
  return { status: "cancelled", cleaned: true, more: false, remaining: 0, message: "Import cancelled. The unfinished data was removed." };
}

/**
 * Cancels one INCOMPLETE import. archive_source (row lock; further chunk and finalize writes are then rejected) comes first, then the
 * first bounded cleanup step; the caller continues with continueIncompleteSupplierCleanup while `more`. Never touches an imported or
 * reviewed source. Repeating it is safe.
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
  const result = await continueIncompleteSupplierCleanup(client, sourceId);
  return !source && result.status === "cancelled" && result.cleaned && !result.more ? { ...result, status: "already_cancelled", message: "This import was already cancelled." } : result;
}

export type IncompleteSupplierImport = { id: string; title: string; filename: string; status: string; fileHash: string; definitionId: string | null; definitionName: string | null; expectedRows: number; expectedChunks: number; storedChunks: number; profile: unknown };

/** Read-only recovery list: this Brand's unfinished imports only (never an imported or archived source), with their stored chunk count. */
export async function supplierIncompleteImports(client: SupabaseClient, brandId: string): Promise<IncompleteSupplierImport[]> {
  if (typeof brandId !== "string" || !brandId) throw Error("Brand is required.");
  type Row = { id: string; title: string; filename: string; status: string; file_hash: string; definition_id: string | null; expected_rows: number; expected_chunks: number; profile: unknown; created_at: string };
  const columns = "id,title,filename,status,file_hash,definition_id,expected_rows,expected_chunks,profile,created_at";
  const found = (await Promise.all(incompleteStatuses.map((status) => supplierRows<Row>(client, "supplier_source_versions", columns, { brand_id: brandId, status })))).flat().sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!found.length) return [];
  const definitions = await supplierRows<{ id: string; name: string }>(client, "supplier_source_definitions", "id,name", { brand_id: brandId });
  const names = new Map(definitions.map((d) => [d.id, d.name]));
  return Promise.all(found.map(async (s) => ({ id: s.id, title: s.title, filename: s.filename, status: s.status, fileHash: s.file_hash, definitionId: s.definition_id, definitionName: s.definition_id ? names.get(s.definition_id) ?? null : null, expectedRows: s.expected_rows, expectedChunks: s.expected_chunks, profile: s.profile,
    storedChunks: (await supplierRows<{ chunk_index: number }>(client, "supplier_source_chunks", "chunk_index", { source_id: s.id }, "chunk_index")).length })));
}
