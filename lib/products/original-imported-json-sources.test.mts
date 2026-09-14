import assert from "node:assert/strict";
import test from "node:test";
import { appendOriginalImportedJsonSource, captureInitialOriginalImportedJsonSource, MAX_ORIGINAL_IMPORTED_JSON_BYTES, validateOriginalImportedJsonSources } from "./original-imported-json-sources.js";

test("captures an initial raw JSON source exactly once and preserves later source boundaries", () => {
  const initial = '{\n  "source": 1\n}';
  const sources = captureInitialOriginalImportedJsonSource([], initial, "initial");
  assert.deepEqual(captureInitialOriginalImportedJsonSource(sources, initial, "duplicate"), sources);
  assert.deepEqual(appendOriginalImportedJsonSource(sources, '{"source":2}', "additional"), [{ id: "initial", rawJson: initial }, { id: "additional", rawJson: '{"source":2}' }]);
});

test("rejects missing, invalid, excessive, and oversized original JSON sources", () => {
  assert.equal(validateOriginalImportedJsonSources([]).valid, false);
  assert.equal(validateOriginalImportedJsonSources([{ id: "one", rawJson: "" }]).valid, false);
  assert.equal(validateOriginalImportedJsonSources(Array.from({ length: 11 }, (_, index) => ({ id: String(index), rawJson: "{}" }))).valid, false);
  assert.equal(validateOriginalImportedJsonSources([{ id: "one", rawJson: "x".repeat(MAX_ORIGINAL_IMPORTED_JSON_BYTES + 1) }]).valid, false);
});
