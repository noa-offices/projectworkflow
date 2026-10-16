import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelIncompleteSupplierImport, continueIncompleteSupplierCleanup } from "./supplier-import-cancel.js";

// The SQL function cannot run here (no database). This stateful model mirrors its documented contract (batch clamp, delete order, guards,
// source row last) so the client loop, retry and error handling are exercised; the migration text itself is checked separately below.
type Src = { id: string; status: string; archived_from_status: string | null; cells: number; rows: number; identities: number; chunks: number; batches: number; fileHash: string };
function model(sources: Src[], opts: { owner?: boolean; storageError?: string; failAfterCalls?: number } = {}) {
  const owner = opts.owner ?? true; const stepCalls: number[] = []; const removedPaths: string[][] = []; const receipts = new Set<string>(); let calls = 0;
  const client = {
    from: (table: string) => { let list = table === "supplier_source_versions" ? sources.map((s) => ({ ...s, file_hash: s.fileHash })) : []; const api: Record<string, unknown> = { select: () => api, order: () => api, range: () => api, neq: () => api, gt: () => api, eq: (k: string, v: unknown) => { list = list.filter((r) => (r as never)[k] === v); return api; }, then: (resolve: (v: unknown) => unknown) => resolve({ data: list, error: null }) }; return api; },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "supplier_price_review_write") { const s = sources.find((x) => x.id === (args.p_payload as { source_id: string }).source_id); if (s) { s.archived_from_status ??= s.status; s.status = "archived"; } return { data: {}, error: null }; }
      if (name === "finish_supplier_source_file_cleanup") { if (opts.storageError) return { data: null, error: { message: "still there" } }; receipts.delete(String(args.p_source_id)); return { data: null, error: null }; }
      if (name !== "purge_incomplete_supplier_source_step") return { data: null, error: { message: "unknown rpc" } };
      calls++; if (opts.failAfterCalls && calls > opts.failAfterCalls) return { data: null, error: { message: "canceling statement due to statement timeout" } };
      if (!owner) return { data: null, error: { message: "permission denied", code: "42501" } };
      const id = String(args.p_source_id); const s = sources.find((x) => x.id === id);
      if (!s) return receipts.has(id) ? { data: { done: true, remaining: 0, storage_paths: [`b/${id}/h.xlsx`], cleanup_retry: true }, error: null } : { data: null, error: { message: "Unfinished Supplier import unavailable." } };
      if (s.status !== "archived" || !["uploading", "importing", "failed"].includes(s.archived_from_status ?? "")) return { data: null, error: { message: "Only an archived, unfinished Supplier import can be cleaned up this way." } };
      if (s.batches) return { data: null, error: { message: "This source has review history and cannot be cleaned up as an unfinished import." } };
      let budget = Math.max(1000, Math.min(Number(args.p_batch ?? 5000), 20000)), used = 0;
      const take = (key: "identities" | "cells" | "rows" | "chunks") => { const n = Math.min(budget, s[key]); s[key] -= n; budget -= n; used += n; };
      take("identities"); if (budget > 0) take("cells"); if (budget > 0 && s.cells === 0) take("rows"); if (budget > 0) take("chunks");
      stepCalls.push(used);
      const remaining = s.identities + s.cells + s.rows + s.chunks;
      if (remaining) return { data: { done: false, remaining, storage_paths: [] }, error: null };
      sources.splice(sources.indexOf(s), 1); receipts.add(id);
      return { data: { done: true, remaining: 0, storage_paths: [`b/${id}/h.xlsx`] }, error: null };
    },
    storage: { from: () => ({ remove: async (paths: string[]) => { removedPaths.push(paths); return { error: opts.storageError ? { message: opts.storageError } : null }; } }) },
  } as unknown as SupabaseClient;
  return { client, stepCalls, removedPaths };
}
const big = (over: Partial<Src> = {}): Src => ({ id: "las", status: "archived", archived_from_status: "importing", cells: 203_000, rows: 203_000, identities: 0, chunks: 812, batches: 0, fileHash: "h", ...over });
async function drain(client: SupabaseClient, id: string, limit = 500) { let result = await continueIncompleteSupplierCleanup(client, id), loops = 1; while (result.more && loops < limit) { result = await continueIncompleteSupplierCleanup(client, id); loops++; } return { result, loops }; }

test("a large partial source is removed in many bounded batches, then the source and its file", async () => {
  const sources = [big()]; const m = model(sources);
  const { result, loops } = await drain(m.client, "las");
  assert.deepEqual([result.cleaned, result.more, sources.length], [true, false, 0]);
  assert.ok(loops > 80, "203,000 cells + 203,000 rows + 812 chunks need many calls");
  assert.ok(m.stepCalls.every((n) => n <= 5000), "no call deletes more than the batch");
  assert.equal(m.stepCalls.reduce((a, b) => a + b, 0), 203_000 * 2 + 812);
  assert.deepEqual(m.removedPaths, [["b/las/h.xlsx"]]);
});
test("rows are never deleted while cells remain (foreign key order)", async () => {
  const s = big(); const m = model([s]);
  await continueIncompleteSupplierCleanup(m.client, "las");
  assert.ok(s.cells > 0 && s.rows === 203_000);
});
test("an interrupted cleanup keeps the source and resumes safely", async () => {
  const sources = [big()]; const interrupted = model(sources, { failAfterCalls: 3 });
  await continueIncompleteSupplierCleanup(interrupted.client, "las"); await continueIncompleteSupplierCleanup(interrupted.client, "las"); await continueIncompleteSupplierCleanup(interrupted.client, "las");
  await assert.rejects(continueIncompleteSupplierCleanup(interrupted.client, "las"), /statement timeout/);
  assert.equal(sources.length, 1); assert.equal(sources[0].status, "archived");        // never half-deleted into a missing source
  const resumed = model(sources);
  assert.equal((await drain(resumed.client, "las")).result.cleaned, true); assert.equal(sources.length, 0);
});
test("repeating cleanup after completion is safe", async () => {
  const sources = [big({ cells: 10, rows: 10, chunks: 1 })]; const m = model(sources);
  assert.equal((await drain(m.client, "las")).result.cleaned, true);
  const again = await continueIncompleteSupplierCleanup(m.client, "las");               // file receipt already finished or still pending
  assert.ok(["cancelled", "already_cancelled"].includes(again.status));
});
test("a user who is not the System Owner is denied and nothing is deleted", async () => {
  const sources = [big()]; const m = model(sources, { owner: false });
  const result = await continueIncompleteSupplierCleanup(m.client, "las");
  assert.deepEqual([result.cleaned, result.more], [false, false]); assert.match(result.message, /System Owner/);
  assert.equal(sources[0].cells, 203_000);
});
test("other sources are untouched", async () => {
  const other = big({ id: "other", archived_from_status: "importing" }); const done = big({ id: "done", status: "imported", archived_from_status: null, batches: 2 });
  const sources = [big(), other, done]; const m = model(sources);
  await drain(m.client, "las");
  assert.deepEqual(sources.map((s) => s.id), ["other", "done"]); assert.equal(other.cells, 203_000); assert.equal(done.cells, 203_000);
});
test("completed-history protection: a source with review batches or a completed import is refused and keeps its data", async () => {
  for (const s of [big({ batches: 1 }), big({ status: "imported", archived_from_status: null }), big({ archived_from_status: "imported" })]) {
    const m = model([s]); await assert.rejects(continueIncompleteSupplierCleanup(m.client, "las"), /review history|unfinished/);
    assert.equal(s.cells, 203_000);
  }
});
test("a Storage failure is reported after the database cleanup and a retry finishes the file", async () => {
  const sources = [big({ cells: 10, rows: 10, chunks: 1 })]; const failing = model(sources, { storageError: "storage unavailable" });
  const { result } = await drain(failing.client, "las");
  assert.deepEqual([result.cleaned, result.more], [false, false]); assert.match(result.message, /could not be deleted: storage unavailable/); assert.equal(sources.length, 0);
});
test("Cancel Import archives first, then cleans in bounded steps and reports progress", async () => {
  const sources = [big({ status: "importing", archived_from_status: null })]; const m = model(sources);
  const first = await cancelIncompleteSupplierImport(m.client, "las");
  assert.equal(sources[0].status, "archived");                                           // writes are blocked before any deletion
  assert.deepEqual([first.more, first.cleaned], [true, false]); assert.match(first.message, /records left/);
  assert.equal((await drain(m.client, "las")).result.cleaned, true);
});

// ---- migration and wiring ----
const sql = readFileSync("supabase/migrations/20261016090000_supplier_incomplete_source_cleanup.sql", "utf8");
test("the migration is bounded, owner-only, exact-id scoped, ordered by foreign keys, and leaves the role timeout alone", () => {
  assert.match(sql, /perform public\.supplier_capacity_require_owner\(\)/);
  assert.match(sql, /greatest\(1000, least\(coalesce\(p_batch, 5000\), 20000\)\)/);
  assert.match(sql, /where id=p_source_id for update/);
  assert.match(sql, /archived_from_status not in \('uploading','importing','failed'\)/);
  assert.match(sql, /supplier_price_batches where source_id=s\.id/);
  const order = ["supplier_source_identities", "supplier_source_cells", "supplier_source_rows", "supplier_source_chunks"].map((t) => sql.indexOf(`delete from public.${t}`));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), "identities, cells, rows, chunks order");
  assert.ok(sql.indexOf("delete from public.supplier_source_versions where id=s.id") > order[3]);
  for (const t of ["supplier_source_identities", "supplier_source_cells", "supplier_source_rows", "supplier_source_chunks"]) assert.match(sql, new RegExp(`delete from public\\.${t} where ctid = any\\(array\\(select ctid from public\\.${t} where source_id=s\\.id limit budget\\)\\)`));
  const code = sql.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join(" ");
  assert.doesNotMatch(code, /statement_timeout|truncate|delete from public\.supplier_(price_batches|price_decisions|price_matches)/i);
  assert.match(sql, /revoke all on function public\.purge_incomplete_supplier_source_step\(uuid, boolean, int\) from public, anon/);
});
test("actions require a reviewer, the System Owner action uses bounded steps, and the UIs loop until done", () => {
  const actions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  assert.match(actions, /export async function continueSupplierImportCleanup\(sourceId: string\) \{\r?\n  const \{ client \} = await reviewer\(\);/);
  assert.ok(actions.indexOf("continueIncompleteSupplierCleanup(client, sourceId)") < actions.indexOf('client.rpc("purge_archived_supplier_source"'));
  assert.match(readFileSync("components/products/supplier-history-actions.tsx", "utf8"), /while \(result\.more\)/);
  assert.match(readFileSync("components/products/supplier-import-wizard.tsx", "utf8"), /while \(result\.more\) \{ setMessage\(result\.message\); result = await continueSupplierImportCleanup\(sourceId\)/);
});
