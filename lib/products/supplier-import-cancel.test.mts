import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelIncompleteSupplierImport, supplierSourceUploadProgress } from "./supplier-import-cancel.js";
import { chunksToUpload, type SupplierUploadProgress } from "./supplier-import-resume.js";

// Orchestration tests with a fake client. The database rules themselves (row lock, archived rejects chunk/finalize, owner-only purge)
// live in the existing migrations and are exercised by their own tests, not here.
type Source = { id: string; status: string; archived_from_status: string | null; file_hash?: string; expected_rows?: number; expected_chunks?: number };
function fake(sources: Source[], opts: { owner?: boolean; storageError?: string; beforeArchive?: (s: Source[]) => void; chunks?: Record<string, number[]> } = {}) {
  const calls: Array<{ kind: string; detail?: unknown }> = [];
  const rows = (table: string) => table === "supplier_source_versions" ? sources : table === "supplier_source_chunks" ? Object.entries(opts.chunks ?? {}).flatMap(([id, list]) => list.map((chunk_index) => ({ source_id: id, chunk_index }))) : [];
  const builder = (table: string) => { let list = [...rows(table)] as Array<Record<string, unknown>>; const api: Record<string, unknown> = { select: () => api, order: () => api, range: () => api, neq: () => api, gt: () => api, eq: (k: string, v: unknown) => { list = list.filter((r) => r[k] === v); return api; }, then: (resolve: (v: unknown) => unknown) => resolve({ data: list, error: null }) }; return api; };
  const client = {
    from: builder,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ kind: `rpc:${name}`, detail: args });
      if (name === "supplier_price_review_write") {
        const payload = args.p_payload as { source_id: string };
        const source = sources.find((s) => s.id === payload.source_id);
        if (args.p_operation === "archive_source") { opts.beforeArchive?.(sources); if (source) { source.archived_from_status = source.status === "archived" ? source.archived_from_status : source.status; source.status = "archived"; } return { data: { id: payload.source_id }, error: null }; }
        if (args.p_operation === "source_unarchive" && source) { source.status = "imported"; source.archived_from_status = null; return { data: { id: source.id }, error: null }; }
        return { data: null, error: { message: "unexpected operation" } };
      }
      if (name === "purge_archived_supplier_source") {
        if (!opts.owner) return { data: null, error: { message: "Only the System Owner can do this." } };
        const index = sources.findIndex((s) => s.id === args.p_source_id);
        if (index < 0) return { data: null, error: { message: "Archived Supplier price list unavailable." } };
        if (sources[index].status !== "archived") return { data: null, error: { message: "Only archived, non-current Supplier price lists can be permanently deleted." } };
        sources.splice(index, 1); return { data: { storage_paths: [`b/${args.p_source_id}/h.xlsx`], cleanup_retry: false }, error: null };
      }
      if (name === "finish_supplier_source_file_cleanup") return { data: null, error: null };
      return { data: null, error: { message: "unknown rpc" } };
    },
    storage: { from: () => ({ remove: async (paths: string[]) => { calls.push({ kind: "storage.remove", detail: paths }); return { error: opts.storageError ? { message: opts.storageError } : null }; } }) },
  } as unknown as SupabaseClient;
  return { client, calls, kinds: () => calls.map((c) => c.kind) };
}
const partial = (id = "s1", status = "importing"): Source => ({ id, status, archived_from_status: null });

test("cancelling a partial import archives (locking out further writes), purges and removes the file, in that order", async () => {
  const f = fake([partial()], { owner: true });
  const result = await cancelIncompleteSupplierImport(f.client, "s1");
  assert.deepEqual([result.status, result.cleaned], ["cancelled", true]);
  assert.deepEqual(f.kinds(), ["rpc:supplier_price_review_write", "rpc:purge_archived_supplier_source", "storage.remove", "rpc:finish_supplier_source_file_cleanup"]);
});

test("only the named source is touched", async () => {
  const sources = [partial("s1"), partial("s2"), { id: "s3", status: "imported", archived_from_status: null }];
  const f = fake(sources, { owner: true });
  await cancelIncompleteSupplierImport(f.client, "s1");
  assert.deepEqual(sources.map((s) => s.id), ["s2", "s3"]);
  for (const call of f.calls.filter((c) => c.kind.startsWith("rpc:"))) assert.ok(JSON.stringify(call.detail).includes("s1") && !JSON.stringify(call.detail).match(/s2|s3/));
});

test("an imported or archived-complete source is refused with no writes", async () => {
  for (const source of [{ id: "s1", status: "imported", archived_from_status: null }, { id: "s1", status: "archived", archived_from_status: "imported" }]) {
    const f = fake([source], { owner: true });
    await assert.rejects(cancelIncompleteSupplierImport(f.client, "s1"), /cannot be cancelled|archived completed import/);
    assert.deepEqual(f.kinds(), []);
  }
});

test("cancellation racing finalization: a import that just finished is restored and not purged", async () => {
  const f = fake([partial()], { owner: true, beforeArchive: (list) => { list[0].status = "imported"; } });
  await assert.rejects(cancelIncompleteSupplierImport(f.client, "s1"), /finished just now/);
  assert.deepEqual(f.kinds(), ["rpc:supplier_price_review_write", "rpc:supplier_price_review_write"]); // archive, then unarchive
  assert.ok(!f.kinds().includes("rpc:purge_archived_supplier_source"));
});

test("repeated cancellation is safe", async () => {
  const sources = [partial()]; const f = fake(sources, { owner: true });
  await cancelIncompleteSupplierImport(f.client, "s1");
  const again = await cancelIncompleteSupplierImport(f.client, "s1");
  assert.deepEqual([again.status, again.cleaned], ["already_cancelled", true]);
  // a half-finished earlier cancellation (archived, not purged) completes on retry
  const left = fake([{ id: "s1", status: "archived", archived_from_status: "importing" }], { owner: true });
  assert.equal((await cancelIncompleteSupplierImport(left.client, "s1")).status, "cancelled");
});

test("a failed file removal is reported, retryable, and does not claim the file was deleted", async () => {
  const f = fake([partial()], { owner: true, storageError: "storage unavailable" });
  const result = await cancelIncompleteSupplierImport(f.client, "s1");
  assert.equal(result.cleaned, false); assert.match(result.message, /could not be deleted: storage unavailable/); assert.match(result.message, /again to retry/);
  assert.ok(!f.kinds().includes("rpc:finish_supplier_source_file_cleanup"));
});

test("a non-owner can stop the import but the purge is refused by the database", async () => {
  const sources = [partial()]; const f = fake(sources, { owner: false });
  const result = await cancelIncompleteSupplierImport(f.client, "s1");
  assert.equal(result.cleaned, false); assert.match(result.message, /System Owner/);
  assert.equal(sources[0].status, "archived"); // further chunk/finalize writes are rejected by the database for an archived source
});

// ---- resume ----
const progress = (over: Partial<SupplierUploadProgress> = {}): SupplierUploadProgress => ({ sourceId: "s1", status: "importing", fileHash: "h", expectedRows: 1000, expectedChunks: 4, storedChunks: [0, 1], ...over });
const file = { fileHash: "h", expectedRows: 1000, chunkCount: 4 };

test("resume uploads only the missing chunks", () => {
  assert.deepEqual(chunksToUpload(progress(), file), [2, 3]);
  assert.deepEqual(chunksToUpload(progress({ storedChunks: [] }), file), [0, 1, 2, 3]);
  assert.deepEqual(chunksToUpload(progress({ storedChunks: [0, 1, 2, 3] }), file), []);
});
test("a changed file, different chunk geometry, unexpected parts, or a non-resumable status is rejected", () => {
  assert.throws(() => chunksToUpload(progress(), { ...file, fileHash: "other" }), /different file/);
  assert.throws(() => chunksToUpload(progress(), { ...file, chunkCount: 8 }), /split differently/);
  assert.throws(() => chunksToUpload(progress(), { ...file, expectedRows: 999 }), /split differently/);
  assert.throws(() => chunksToUpload(progress({ storedChunks: [0, 9] }), file), /unexpected parts/);
  assert.throws(() => chunksToUpload(progress({ status: "archived" }), file), /cannot be resumed/);
  assert.throws(() => chunksToUpload(progress({ status: "imported" }), file), /already imported/);
});
test("progress reads one source's chunk receipts only", async () => {
  const f = fake([{ ...partial("s1"), file_hash: "h", expected_rows: 1000, expected_chunks: 4 }, partial("s2")], { chunks: { s1: [0, 1], s2: [0] } });
  const p = await supplierSourceUploadProgress(f.client, "s1");
  assert.deepEqual([p.status, p.fileHash, p.expectedChunks, p.storedChunks], ["importing", "h", 4, [0, 1]]);
  await assert.rejects(supplierSourceUploadProgress(f.client, "missing"), /unavailable/);
  assert.deepEqual(f.kinds(), []); // read-only: no rpc or storage calls
});

// ---- wiring ----
test("actions require an authenticated reviewer and wire the helpers; the wizard keeps its chunking and confirms once", () => {
  const actions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  const wizard = readFileSync("components/products/supplier-import-wizard.tsx", "utf8");
  for (const name of ["supplierSourceUploadStatus", "cancelSupplierImport"]) assert.match(actions, new RegExp(`export async function ${name}\\(sourceId: string\\) \\{\\r?\\n  const \\{ client \\} = await reviewer\\(\\);`));
  assert.match(wizard, /supplierImportChunks\(importRows, 500, 600_000, stored\)/);   // chunk geometry unchanged, no parallel upload
  assert.equal((wizard.match(/window\.confirm\(/g) ?? []).length, 2); // one confirmation per cancel entry point (in-session and recovery list)
  assert.match(wizard, /runSupplierImportUpload\(uploadDeps\(file\), \{ sourceId: result\.id/);
  assert.match(wizard, /Resume Import/); assert.match(wizard, /Cancel Import/);
  assert.doesNotMatch(wizard, /Promise\.all\([^)]*uploadSupplierChunk/);
  assert.match(wizard, /setUnfinished\(null\); setPhase\("Complete"\)/);               // "not finished" state is cleared only after finalize
});
