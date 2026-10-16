import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// No database is available to the test suite, so equivalence is checked against the migration TEXT: the set-based statements must use
// exactly the expressions of the original per-row loops, keep their order and error text, and fail closed when the deployed body differs.
const dir = "supabase/migrations/";
const original = readFileSync(`${dir}20261002082357_supplier_price_source_review.sql`, "utf8");
const compact = readFileSync(`${dir}20261006150000_supplier_compact_source_rows.sql`, "utf8");
const bulk = readFileSync(`${dir}20261016120000_supplier_chunk_bulk_insert.sql`, "utf8");
const code = bulk.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n");
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

test("cell values are exactly the former per-cell INSERT expressions, in the same column order", () => {
  const former = /insert into public\.supplier_source_cells values\(([\s\S]+?)\);\s*end loop;/.exec(original)![1];
  const now = /insert into public\.supplier_source_cells\s+select s\.id,([\s\S]+?)\s+from jsonb_array_elements\(p_payload->'cells'\)/.exec(code)![1];
  assert.equal(squash(`s.id,${now}`.replaceAll("cv->", "c->")), squash(former));
});
test("row values are exactly the deployed per-row expressions (including the retained-column rule)", () => {
  const deployed = /new_rows constant text := \$new\$values\(([\s\S]+?)\);\$new\$;/.exec(compact)![1];
  const now = /insert into public\.supplier_source_rows\(source_id,unit_key,row_number,sheet,raw_extras,page_reference\)\s+select ([\s\S]+?)\s+from jsonb_array_elements\(p_payload->'rows'\)/.exec(code)![1];
  assert.equal(squash(now.replaceAll("rv->", "r->")), squash(deployed));
});
test("order and errors: rows first, then the provenance check with the same message, then cells, then the receipt", () => {
  const rows = code.indexOf("insert into public.supplier_source_rows"), check = code.indexOf("Cell provenance is outside this chunk"), cells = code.indexOf("insert into public.supplier_source_cells"), receipt = code.lastIndexOf("anchor_receipt");
  assert.ok(rows > 0 && rows < check && check < cells && cells < receipt);
  assert.ok(original.includes("raise exception 'Cell provenance is outside this chunk'"));
  assert.match(code, /not coalesce\(\(cv->>'row_key'\) = any\(array\(select xv->>'unit_key' from jsonb_array_elements\(p_payload->'rows'\) xv\)\), false\)/); // a null row_key is still rejected
  assert.match(code, /order by ord/);                                                                                       // deterministic payload order
});
test("the patch is fail-closed, single-line anchored, and leaves locking, validation, idempotency and counters alone", () => {
  assert.match(code, /<>1 then\s+raise exception 'Deployed supplier review RPC differs/);
  for (const anchor of ["anchor_rows_loop", "anchor_cells_loop", "anchor_retained", "anchor_receipt"]) assert.ok(code.includes(`array[anchor_rows_loop, anchor_cells_loop, anchor_retained, anchor_receipt]`) && code.includes(anchor));
  assert.ok(original.includes("for r in select value from jsonb_array_elements(p_payload->'rows') loop") && original.includes("for c in select value from jsonb_array_elements(p_payload->'cells') loop"));
  assert.ok(original.includes("insert into public.supplier_source_chunks values(s.id,chunk,p_payload);"));
  // The chunk branch's lock, size check, idempotent receipt and counters are not part of any anchor or replacement.
  for (const untouched of ["for update", "Chunk retry payload changed", "Invalid import chunk", "stored_rows=stored_rows+", "Source is immutable"]) assert.ok(!code.includes(untouched), untouched);
  assert.doesNotMatch(code, /delete from|drop |truncate|alter table|create index|grant |revoke /i);
});
test("no variable of the deployed function collides with the aliases used by the set-based statements", () => {
  const declared = /declare s public\.supplier_source_versions;[^]*?begin/.exec(original)![0];
  for (const alias of ["rv", "cv", "xv", "ord", "t"]) assert.doesNotMatch(declared, new RegExp(`\\b${alias}\\b[ ;]`), alias);
});
test("TypeScript chunk geometry is unchanged: 500-unit budget, 600 KB cap, sequential uploads", () => {
  const wizard = readFileSync("components/products/supplier-import-wizard.tsx", "utf8");
  assert.equal((wizard.match(/500, 600_000/g) ?? []).length, 2);
  assert.doesNotMatch(wizard, /Promise\.all\([^)]*uploadSupplierChunk/);
});
