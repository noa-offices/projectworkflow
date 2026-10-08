import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import * as temporary from "./temporary-product-source.js";

async function load<T>(adminFactory: () => unknown): Promise<T> {
  const url = new URL("./product-source-cleanup.server.ts", import.meta.url);
  const output = ts.transpileModule(await readFile(url, "utf8"), { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => name === "server-only" ? {} : name === "@/lib/supabase/admin" ? { createAdminClient: adminFactory } : name === "./temporary-product-source" ? temporary : createRequire(url)(name), compiled, compiled.exports);
  return compiled.exports as T;
}

const old = (id: string, size = 10) => ({ id, name: `${id}-source.pdf`, created_at: "2020-01-01T00:00:00Z", metadata: { size } });

test("analyzer lists only the temporary namespace and reports safe bucket support", async () => {
  const calls: unknown[] = [];
  type Analysis = { status: string; reclaimable: { objects: number; bytes: number }; buckets: Array<{ bucket: string; status: string }>; quotationPdfNote: string };
  const api = await load<{ analyzeProductSourceCleanup(now?: Date): Promise<Analysis> }>(() => ({ client: { storage: { from(bucket: string) { assert.equal(bucket, temporary.PRODUCT_SOURCE_BUCKET); return { async list(prefix: string, options: unknown) { calls.push([prefix, options]); return { data: [old("123e4567-e89b-42d3-a456-426614174000")], error: null }; } }; } } }, error: null }));
  const analysis = await api.analyzeProductSourceCleanup(new Date("2026-10-08T00:00:00Z"));
  assert.equal(analysis.status, "available"); assert.equal(analysis.reclaimable.objects, 1); assert.equal(analysis.reclaimable.bytes, 10);
  assert.equal(analysis.buckets.find((entry) => entry.bucket === "supplier-price-sources")?.status, "managed_elsewhere");
  assert.equal(analysis.buckets.find((entry) => entry.bucket === "product-images")?.status, "unavailable");
  assert.match(analysis.quotationPdfNote, /on demand.*not stored persistently/i);
  assert.equal(calls.length, 1);
});

test("cleanup re-analyzes, rejects stale paths, and removes only current eligible candidates", async () => {
  let files = [old("123e4567-e89b-42d3-a456-426614174000")]; const removed: string[][] = [];
  type CleanupResult = { ok: boolean; analysis: { reclaimable: { objects: number } } };
  const api = await load<{ cleanProductSourceCandidates(paths: string[]): Promise<CleanupResult> }>(() => ({ client: { storage: { from() { return {
    async list() { return { data: files, error: null }; },
    async remove(paths: string[]) { removed.push(paths); files = files.filter((file) => !paths.includes(`${temporary.PRODUCT_SOURCE_TEMPORARY_PREFIX}/${file.name}`)); return { error: null }; },
  }; } } }, error: null }));
  const eligible = `${temporary.PRODUCT_SOURCE_TEMPORARY_PREFIX}/${files[0].name}`;
  const stale = await api.cleanProductSourceCandidates(["smart-source-qa/223e4567-e89b-42d3-a456-426614174000-missing.pdf"]);
  assert.equal(stale.ok, false); assert.equal(removed.length, 0);
  const cleaned = await api.cleanProductSourceCandidates([eligible]);
  assert.equal(cleaned.ok, true); assert.deepEqual(removed, [[eligible]]); assert.equal(cleaned.analysis.reclaimable.objects, 0);
});
