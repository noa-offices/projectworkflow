import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FINALIZE_MAX_CELLS, FINALIZE_MIN_CELLS, FINALIZE_START_CELLS, finalizeSupplierImport, runSupplierImportUpload, type SupplierUploadDeps, type SupplierUploadProgress } from "./supplier-import-resume.js";
import { findFileInOtherDefinition, replacementMismatchWarning, validateReplacementRequest } from "./supplier-replacement.js";
import type { RawSupplierRow } from "./supplier-price-contracts.js";

// The SQL steps cannot run here (no database). This model mirrors their contract: whole codes per step within a cell budget, idempotent inserts,
// a statement that exceeds the time limit is rolled back, imported only on the last step. It exercises the caller's loop, resume and honesty rules.
function sourceModel(opts: { codes: number; cellsPerCode: number; timeoutAbove?: number; failAtCall?: number }) {
  const built = new Set<number>(); let calls = 0; let status = "importing"; const budgets: number[] = []; const compactCalls: number[] = [];
  let payloads = 816;
  const deps = (over: Partial<SupplierUploadDeps> = {}): SupplierUploadDeps & { events: string[] } => {
    const events: string[] = [];
    return { events,
      storeFile: async () => {}, attachFile: async () => {}, status: async () => ({ sourceId: "s", status, fileHash: "h", expectedRows: 4, expectedChunks: 4, storedChunks: [0, 1, 2, 3] } as SupplierUploadProgress), uploadChunk: async () => { events.push("chunk"); },
      compact: async () => { compactCalls.push(payloads); payloads = Math.max(0, payloads - 25); return { remaining: payloads }; },
      finalize: async (_id, maxCells = 20000) => {
        calls++; budgets.push(maxCells);
        if (opts.failAtCall === calls) throw Error("connection reset");
        if (opts.timeoutAbove && maxCells > opts.timeoutAbove) throw Error("canceling statement due to statement timeout"); // rolled back: nothing built
        let cells = 0;
        for (let code = 0; code < opts.codes; code++) { if (built.has(code)) continue; if (cells > 0 && cells + opts.cellsPerCode > maxCells) break; built.add(code); cells += opts.cellsPerCode; }   // whole codes, at least one
        const remaining = opts.codes - built.size;
        if (remaining === 0) status = "imported";
        return { done: remaining === 0, remaining_codes: remaining, status };
      },
      onPhase: (phase) => events.push(`phase:${phase}`), onMessage: () => {}, ...over };
  };
  return { deps, built, budgets, compactCalls, status: () => status, calls: () => calls, payloads: () => payloads };
}

test("a normal import finalizes in bounded steps and reports imported only at the end", async () => {
  const m = sourceModel({ codes: 100, cellsPerCode: 10 }); const d = m.deps();
  await finalizeSupplierImport(d, "s");
  assert.equal(m.built.size, 100); assert.equal(m.status(), "imported");
  assert.deepEqual(d.events.filter((e) => e.startsWith("phase:")), ["phase:Finalizing", "phase:Complete"]);
  assert.equal(m.budgets[0], FINALIZE_START_CELLS);
});
test("a step that times out is rolled back and retried smaller; no identity is built twice", async () => {
  const m = sourceModel({ codes: 2000, cellsPerCode: 10, timeoutAbove: 1000 }); const d = m.deps();
  await finalizeSupplierImport(d, "s");
  assert.equal(m.built.size, 2000);                                   // every code built exactly once (set model + idempotent inserts)
  assert.ok(m.budgets.includes(1000) || m.budgets.includes(500));
  assert.ok(m.budgets.slice(0, 3).some((b) => b <= 1000));
  assert.equal(m.status(), "imported");
});
test("interrupted finalization resumes from where it stopped without re-uploading", async () => {
  const m = sourceModel({ codes: 500, cellsPerCode: 10, failAtCall: 2 });
  await assert.rejects(finalizeSupplierImport(m.deps(), "s"), /Resume Finalization/);
  assert.ok(m.built.size > 0 && m.built.size < 500); assert.notEqual(m.status(), "imported");
  const before = m.built.size; const resume = m.deps();
  await runSupplierImportUpload(resume, { sourceId: "s", brandId: "b", hash: "h", sourceType: "xlsx", rowCount: 4, chunks: Array.from({ length: 4 }, () => [{ unit_key: "u", row_number: 1, sheet: "S", values: {} } as RawSupplierRow]) });
  assert.ok(!resume.events.includes("chunk"));                        // stored parts are skipped: finalization only
  assert.equal(m.built.size, 500); assert.ok(m.built.size > before); assert.equal(m.status(), "imported");
});
test("repeating finalization after completion is safe", async () => {
  const m = sourceModel({ codes: 20, cellsPerCode: 10 });
  await finalizeSupplierImport(m.deps(), "s"); const built = m.built.size;
  await finalizeSupplierImport(m.deps(), "s");
  assert.equal(m.built.size, built);
});
test("the step budget grows while steps are fast, shrinks when slow, and stays within bounds", async () => {
  let clock = 0; const fast = sourceModel({ codes: 100000, cellsPerCode: 1 }); const d = fast.deps();
  const slowDeps = { ...d, finalize: async (id: string, max?: number) => { clock += 100; return d.finalize(id, max); } };
  await finalizeSupplierImport(slowDeps, "s", () => clock);
  assert.ok(Math.max(...fast.budgets) === FINALIZE_MAX_CELLS && fast.budgets.every((b) => b >= FINALIZE_MIN_CELLS && b <= FINALIZE_MAX_CELLS));
  clock = 0; const slow = sourceModel({ codes: 100000, cellsPerCode: 1 }); const sd = slow.deps();
  await finalizeSupplierImport({ ...sd, finalize: async (id, max) => { clock += 6000; return sd.finalize(id, max); } }, "s", () => clock);
  assert.equal(slow.budgets.at(-1), FINALIZE_MIN_CELLS);
});
test("repeated timeouts at the smallest budget stop with an actionable message; a non-confirmed status is never reported complete", async () => {
  const hopeless = sourceModel({ codes: 100, cellsPerCode: 10, timeoutAbove: 1 });
  await assert.rejects(finalizeSupplierImport(hopeless.deps(), "s"), /Resume Finalization/);
  assert.notEqual(hopeless.status(), "imported");
  const unconfirmed = sourceModel({ codes: 1, cellsPerCode: 1 }); const d = unconfirmed.deps();
  const events: string[] = [];
  await assert.rejects(finalizeSupplierImport({ ...d, onPhase: (p) => events.push(p), finalize: async () => ({ done: true, remaining_codes: 0, status: "importing" }) }, "s"), /did not confirm the imported status/);
  assert.ok(!events.includes("Complete"));
});
test("chunk payloads are compacted in small steps before finalization, tolerate an undeployed function, and never block finalization", async () => {
  const m = sourceModel({ codes: 10, cellsPerCode: 10 }); const d = m.deps();
  await finalizeSupplierImport(d, "s");
  assert.equal(m.payloads(), 0); assert.equal(m.compactCalls.length, Math.ceil(816 / 25));
  const none = sourceModel({ codes: 10, cellsPerCode: 10 });
  await finalizeSupplierImport(none.deps({ compact: async () => ({ remaining: 0, unavailable: true }) }), "s"); assert.equal(none.status(), "imported");
  const broken = sourceModel({ codes: 10, cellsPerCode: 10 });
  await finalizeSupplierImport(broken.deps({ compact: async () => { throw Error("boom"); } }), "s"); assert.equal(broken.status(), "imported");
});

// ---- wrong-definition protection ----
type Row = Record<string, unknown>;
const client = (tables: Record<string, Row[]>) => ({ from: (t: string) => { let list = [...(tables[t] ?? [])]; const api: Record<string, unknown> = { select: () => api, order: () => api, range: () => api, neq: () => api, gt: () => api, eq: (k: string, v: unknown) => { list = list.filter((r) => r[k] === v); return api; }, then: (resolve: (v: unknown) => unknown) => resolve({ data: list, error: null }) }; return api; } }) as unknown as SupabaseClient;
const tables = (sources: Row[]) => ({ supplier_source_definitions: [{ id: "furn", brand_id: "b1", name: "LAS Furniture", is_active: true }, { id: "chairs", brand_id: "b1", name: "LAS Chairs", is_active: true }], supplier_source_versions: sources });
test("a file already imported under another price list is blocked, naming both lists", async () => {
  const c = client(tables([{ id: "v1", brand_id: "b1", definition_id: "chairs", status: "imported", file_hash: "H" }]));
  assert.equal(await findFileInOtherDefinition(c, { brandId: "b1", definitionId: "furn", fileHash: "H" }), "LAS Chairs");
  await assert.rejects(validateReplacementRequest(c, { brandId: "b1", definitionId: "furn", effectiveFrom: "2026-10-01", fileHash: "H" }), /already imported as "LAS Chairs", not "LAS Furniture"/);
  assert.equal(await findFileInOtherDefinition(c, { brandId: "b1", definitionId: "chairs", fileHash: "H" }), null);          // its own list is fine
  const archived = client(tables([{ id: "v1", brand_id: "b1", definition_id: "chairs", status: "archived", file_hash: "H" }]));
  assert.equal(await findFileInOtherDefinition(archived, { brandId: "b1", definitionId: "furn", fileHash: "H" }), null);     // archived/failed copies do not block
  assert.equal((await validateReplacementRequest(c, { brandId: "b1", definitionId: "furn", effectiveFrom: "2026-10-01", fileHash: "OTHER" })).definitionName, "LAS Furniture");
});
test("column evidence warns but is never derived from the file name", () => {
  assert.match(replacementMismatchWarning({ definitionName: "LAS Furniture", requiredColumns: ["CODE", "PRICE"], fileHeaders: ["NOME_FILE", "PRICE"] })!, /does not contain the columns.*CODE/);
  assert.equal(replacementMismatchWarning({ definitionName: "x", requiredColumns: ["CODE"], fileHeaders: ["CODE", "X"] }), null);
  assert.equal(replacementMismatchWarning({ definitionName: "x", requiredColumns: null, fileHeaders: ["A"] }), null);
  assert.doesNotMatch(readFileSync("lib/products/supplier-replacement.ts", "utf8").split("replacementMismatchWarning")[1].slice(0, 900), /filename|file\.name/i);
});

// ---- migration and wiring ----
const sql = readFileSync("supabase/migrations/20261016150000_supplier_chunk_payload_compaction_step.sql", "utf8");
const code = sql.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join(" ");
test("the compaction migration is a new, bounded, source-scoped function and leaves finalize alone", () => {
  assert.match(code, /create function public\.supplier_compact_chunk_payloads_step\(p_source_id uuid, p_limit int default 25\)/);
  assert.match(code, /current_user_can_review_brand_prices\(\)/); assert.match(code, /p_limit not between 1 and 100/);
  assert.match(code, /where id=p_source_id for update/); assert.match(code, /stored_rows<>s\.expected_rows or s\.stored_cells<>s\.expected_cells or chunk_count<>s\.expected_chunks/);
  assert.match(code, /where source_id=s\.id and chunk_index = any\(array\(select chunk_index from public\.supplier_source_chunks where source_id=s\.id and payload is not null order by chunk_index limit p_limit\)\)/);
  assert.doesNotMatch(code, /supplier_finalize_source_step|delete from|drop |truncate|statement_timeout|supplier_source_(cells|rows|identities)/i);
  assert.match(code, /revoke all on function public\.supplier_compact_chunk_payloads_step\(uuid, int\) from public, anon/);
});
test("the compaction expression is the existing finalize expression", () => {
  const staged = readFileSync("supabase/migrations/20261006180000_supplier_staged_finalize.sql", "utf8");
  const expression = "payload_sha256=encode(sha256(convert_to(payload::text,'UTF8')),'hex'),payload_bytes=pg_column_size(payload),payload=null,compacted_at=now()";
  assert.ok(staged.includes(expression) && sql.includes(expression));
});
test("wiring: bounded step sizes from the app, reviewer gates, Resume Finalization, destination confirmation", () => {
  const actions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  assert.match(actions, /export async function finalizeSupplierSource\(sourceId: string, maxCells\?: number\) \{\r?\n  const \{ client \} = await reviewer\(\);/);
  assert.match(actions, /maxCells >= 500 && maxCells <= 20000/);
  assert.match(actions, /export async function compactSupplierSourceChunks\(sourceId: string\) \{\r?\n  const \{ client \} = await reviewer\(\);/);
  assert.match(actions, /unavailable: true/);
  const wizard = readFileSync("components/products/supplier-import-wizard.tsx", "utf8");
  assert.match(wizard, /Resume Finalization/); assert.match(wizard, /finalizeSupplierImport\(uploadDeps\(null\), item\.id\)/);
  assert.match(wizard, /!== "imported"\) throw Error\("The database does not show this import as finished yet/);
  assert.match(wizard, /Replacing: \{replace\.definitionName\}/); assert.match(wizard, /Selected file: \{file\.name\}/);
  assert.match(wizard, /\(Boolean\(replace\) && !destinationConfirmed\)/);
  assert.match(wizard, /validateSupplierReplacement\(brandId, replace\.definitionId, effective, hash\)/);
  assert.match(wizard, /supplierImportChunks\(importRows, 500, 600_000, stored\)/);
});
