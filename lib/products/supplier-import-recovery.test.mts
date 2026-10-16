import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelIncompleteSupplierImport, supplierIncompleteImports } from "./supplier-import-cancel.js";
import { resolveImportDefinition, runSupplierImportUpload, type SupplierUploadDeps, type SupplierUploadProgress } from "./supplier-import-resume.js";
import type { RawSupplierRow } from "./supplier-price-contracts.js";

type Src = { id: string; brand_id: string; title: string; filename: string; status: string; file_hash: string; definition_id: string | null; expected_rows: number; expected_chunks: number; profile: unknown; created_at: string; archived_from_status: string | null };
const src = (over: Partial<Src> = {}): Src => ({ id: "s1", brand_id: "b1", title: "LAS", filename: "las.xlsx", status: "importing", file_hash: "h", definition_id: "d1", expected_rows: 1000, expected_chunks: 4, profile: { full_code_column: "CODE" }, created_at: "2026-01-01", archived_from_status: null, ...over });
function db(sources: Src[], chunks: Record<string, number[]> = {}, definitions = [{ id: "d1", brand_id: "b1", name: "LAS Chairs" }, { id: "d9", brand_id: "b2", name: "Other" }]) {
  const calls: string[] = [];
  const table = (name: string): Array<Record<string, unknown>> => name === "supplier_source_versions" ? sources as never : name === "supplier_source_definitions" ? definitions : name === "supplier_source_chunks" ? Object.entries(chunks).flatMap(([id, list]) => list.map((chunk_index) => ({ source_id: id, chunk_index }))) : [];
  const client = {
    from: (name: string) => { let list = [...table(name)]; const api: Record<string, unknown> = { select: () => api, order: () => api, range: () => api, neq: () => api, gt: () => api, eq: (k: string, v: unknown) => { list = list.filter((r) => r[k] === v); return api; }, then: (resolve: (v: unknown) => unknown) => resolve({ data: list, error: null }) }; return api; },
    rpc: async (rpcName: string, args: Record<string, unknown>) => {
      calls.push(rpcName);
      if (rpcName === "supplier_price_review_write") { const s = sources.find((x) => x.id === (args.p_payload as { source_id: string }).source_id); if (s) { s.archived_from_status = s.status; s.status = "archived"; } return { data: {}, error: null }; }
      if (rpcName === "purge_incomplete_supplier_source_step") { const i = sources.findIndex((x) => x.id === args.p_source_id); if (i < 0) return { data: null, error: { message: "unavailable" } }; sources.splice(i, 1); return { data: { done: true, remaining: 0, storage_paths: [] }, error: null }; }
      return { data: null, error: null };
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  } as unknown as SupabaseClient;
  return { client, calls };
}

test("after a reload the recovery list shows this brand's unfinished imports only, with their stored parts", async () => {
  const sources = [src(), src({ id: "s2", status: "imported" }), src({ id: "s3", status: "archived", archived_from_status: "importing" }), src({ id: "s4", brand_id: "b2", definition_id: "d9" }), src({ id: "s5", status: "failed", created_at: "2026-02-01" })];
  const f = db(sources, { s1: [0, 1, 2], s4: [0] });
  const list = await supplierIncompleteImports(f.client, "b1");
  assert.deepEqual(list.map((i) => i.id), ["s5", "s1"]);                                  // completed, archived and other-brand sources are excluded
  assert.deepEqual(list.find((i) => i.id === "s1"), { id: "s1", title: "LAS", filename: "las.xlsx", status: "importing", fileHash: "h", definitionId: "d1", definitionName: "LAS Chairs", expectedRows: 1000, expectedChunks: 4, storedChunks: 3, profile: { full_code_column: "CODE" } });
  assert.deepEqual(f.calls, []);                                                          // read-only
  assert.deepEqual(await supplierIncompleteImports(db([src({ status: "imported" })]).client, "b1"), []);
});

test("cancel works from the persisted list after a reload and the import disappears", async () => {
  const sources = [src(), src({ id: "other", created_at: "2026-03-01" })];
  const f = db(sources);
  const target = (await supplierIncompleteImports(f.client, "b1")).find((i) => i.id === "s1")!;
  await cancelIncompleteSupplierImport(f.client, target.id);                              // the existing guarded cancel, unchanged
  assert.deepEqual((await supplierIncompleteImports(f.client, "b1")).map((i) => i.id), ["other"]);
});

// ---- resume ----
const rows = (n: number): RawSupplierRow[][] => Array.from({ length: n }, (_, i) => [{ unit_key: String(i), row_number: i + 1, sheet: "S", values: {} }]);
function uploader(progress: Partial<SupplierUploadProgress> = {}) {
  const events: string[] = []; const base: SupplierUploadProgress = { sourceId: "s1", status: "importing", fileHash: "h", expectedRows: 4, expectedChunks: 4, storedChunks: [0, 1], ...progress };
  let finalizeCalls = 0;
  const deps: SupplierUploadDeps = {
    storeFile: async (path) => { events.push(`store:${path}`); }, attachFile: async () => { events.push("attach"); },
    status: async () => base, uploadChunk: async (_id, index) => { events.push(`chunk:${index}`); },
    finalize: async () => (++finalizeCalls < 3 ? { done: false, remaining_codes: 5 } : { done: true, remaining_codes: 0 }),
    onPhase: (phase, p) => events.push(`phase:${phase}${p ? `:${p.done}/${p.total}` : ""}`), onMessage: () => {},
  };
  return { deps, events, finalizeCalls: () => finalizeCalls };
}
const params = { sourceId: "s1", brandId: "b1", hash: "h", sourceType: "xlsx", rowCount: 4, chunks: rows(4) };

test("resume with the original file uploads only the missing parts, then finalizes", async () => {
  const u = uploader();
  await runSupplierImportUpload(u.deps, params);
  assert.deepEqual(u.events.filter((e) => e.startsWith("chunk:")), ["chunk:2", "chunk:3"]);
  assert.deepEqual(u.events.filter((e) => e.startsWith("phase:")), ["phase:Uploading:2/4", "phase:Uploading:3/4", "phase:Uploading:4/4", "phase:Finalizing", "phase:Complete"]);
  assert.equal(u.finalizeCalls(), 3);
  assert.equal(u.events[0], "store:b1/s1/h.xlsx");
});
test("resume with a different file or different chunk geometry is rejected before any part is uploaded", async () => {
  for (const [override, message] of [[{ hash: "other" }, /different file/], [{ rowCount: 5 }, /split differently/], [{ chunks: rows(8) }, /split differently/]] as const) {
    const u = uploader();
    await assert.rejects(runSupplierImportUpload(u.deps, { ...params, ...override }), message);
    assert.ok(!u.events.some((e) => e.startsWith("chunk:") || e.startsWith("phase:Finalizing")));
  }
  const archived = uploader({ status: "archived" });
  await assert.rejects(runSupplierImportUpload(archived.deps, params), /cannot be resumed/);
});

// ---- definition reuse ----
const create = () => { let calls = 0; return { fn: async () => `new-${++calls}`, count: () => calls }; };
test("a retry reuses the definition instead of creating another; a genuinely new list still creates one", async () => {
  const c = create();
  const first = await resolveImportDefinition({ definitionId: "new", newName: "LAS Chairs", fileHash: "h", incomplete: [], created: null, create: c.fn });
  assert.deepEqual([first.id, c.count()], ["new-1", 1]);                                  // normal creation still works
  const sameSession = await resolveImportDefinition({ definitionId: "new", newName: "LAS Chairs", fileHash: "h", incomplete: [], created: first.created, create: c.fn });
  assert.deepEqual([sameSession.id, c.count()], ["new-1", 1]);                            // retry in the same page
  const afterReload = await resolveImportDefinition({ definitionId: "new", newName: "LAS Chairs", fileHash: "h", incomplete: [{ fileHash: "h", definitionId: "d-existing" }], created: null, create: c.fn });
  assert.deepEqual([afterReload.id, c.count()], ["d-existing", 1]);                       // the unfinished import's own definition
  const different = await resolveImportDefinition({ definitionId: "new", newName: "Other list", fileHash: "h2", incomplete: [{ fileHash: "h", definitionId: "d-existing" }], created: first.created, create: c.fn });
  assert.deepEqual([different.id, c.count()], ["new-2", 2]);                              // another file/name is a new definition
  const picked = await resolveImportDefinition({ definitionId: "d5", newName: "x", fileHash: "h", incomplete: [{ fileHash: "h", definitionId: "d-existing" }], created: null, create: c.fn });
  assert.deepEqual([picked.id, c.count()], ["d5", 2]);                                    // an explicit existing choice is respected
});

test("wiring: recovery is shown to approvers, resume asks for the file again, no file contents are persisted, chunking is unchanged", () => {
  const wizard = readFileSync("components/products/supplier-import-wizard.tsx", "utf8");
  const actions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  assert.match(actions, /export async function listIncompleteSupplierImports\(brandId: string\) \{\r?\n  const \{ client \} = await reviewer\(\);/);
  assert.match(wizard, /aria-label="Incomplete import"/); assert.match(wizard, /Resume Import<input type="file"/); assert.match(wizard, /Cancel Import/);
  assert.match(wizard, /!== item\.fileHash\) throw Error\("This is not the original file/);
  assert.match(wizard, /if \(approver\) void refreshIncomplete\(\)/);
  assert.match(wizard, /await cancelSupplierImport\(item\.id\)/);                         // the existing cancel action, unchanged
  assert.doesNotMatch(wizard, /localStorage|sessionStorage|indexedDB/);
  assert.equal((wizard.match(/supplierImportChunks\(/g) ?? []).length, 2); assert.equal((wizard.match(/500, 600_000/g) ?? []).length, 2);
  assert.doesNotMatch(wizard, /Promise\.all\([^)]*uploadSupplierChunk/);
});
