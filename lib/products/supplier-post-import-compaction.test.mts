import assert from "node:assert/strict";
import { test } from "node:test";
import { compactAfterSupplierImport, RAW_CLEANUP_NOTE } from "./supplier-post-import-compaction";
const imported = { done: true, status: "imported", identity_count: 4000 };
const complete = { source_id: "own-source", done: true, rows_compacted_at: "2026-10-22T12:00:00Z" };
test("only successful finalization with identities starts cleanup", async () => {
  for (const progress of [{ ...imported, done: false }, { ...imported, status: "importing" }]) {
    assert.equal(await compactAfterSupplierImport(progress, "own-source", async () => assert.fail()), undefined);
  }
  assert.equal(await compactAfterSupplierImport({ ...imported, identity_count: 0 }, "own-source", async () => assert.fail()), RAW_CLEANUP_NOTE);
});
test("bounded steps and already-compacted acknowledgements preserve successful import", async () => {
  let calls = 0;
  assert.equal(await compactAfterSupplierImport(imported, "own-source", async () => ({ data: ++calls === 3 ? complete : { ...complete, done: false }, error: null })), undefined);
  assert.equal(calls, 3);
  assert.equal(await compactAfterSupplierImport(imported, "own-source", async () => ({ data: complete, error: null })), undefined);
});
test("RPC rejection, missing migration, transport loss and invalid acknowledgements only warn", async () => {
  for (const data of [null, {}, { ...complete, source_id: "other" }, { ...complete, rows_compacted_at: null }]) {
    assert.equal(await compactAfterSupplierImport(imported, "own-source", async () => ({ data, error: null })), RAW_CLEANUP_NOTE);
  }
  assert.equal(await compactAfterSupplierImport(imported, "own-source", async () => ({ data: complete, error: { code: "PGRST202" } })), RAW_CLEANUP_NOTE);
  assert.equal(await compactAfterSupplierImport(imported, "own-source", async () => { throw Error("timeout"); }), RAW_CLEANUP_NOTE);
});
test("call and time limits retain remaining data with a non-blocking note", async () => {
  let calls = 0;
  const step = async () => { calls++; return { data: { ...complete, done: false }, error: null }; };
  assert.equal(await compactAfterSupplierImport(imported, "own-source", step, () => 0), RAW_CLEANUP_NOTE);
  assert.equal(calls, 32);
  let time = 0; calls = 0;
  assert.equal(await compactAfterSupplierImport(imported, "own-source", step, () => time += 10_000), RAW_CLEANUP_NOTE);
  assert.equal(calls, 1);
});
