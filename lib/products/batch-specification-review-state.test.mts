import assert from "node:assert/strict";
import test from "node:test";
import {
  initializeEditableBatchSpecificationSuggestions,
  selectedBatchSpecificationSuggestions,
  updateEditableBatchSpecificationSuggestion,
} from "./batch-specification-review-state.js";

test("AI suggestions initialize editable selected values", () => {
  assert.deepEqual(initializeEditableBatchSpecificationSuggestions([
    { targetId: "one", specificationSuggestion: "AI wording" },
    { targetId: "two", specificationSuggestion: null },
  ]), [{ targetId: "one", value: "AI wording", selected: true }]);
});

test("edits apply locally, Use reselects, and Keep Current excludes", () => {
  const initial = initializeEditableBatchSpecificationSuggestions([{ targetId: "one", specificationSuggestion: "AI wording" }]);
  const edited = updateEditableBatchSpecificationSuggestion(initial, "one", { value: "  Edited wording  " });
  assert.deepEqual(selectedBatchSpecificationSuggestions(edited), [{ targetId: "one", specificationSuggestion: "Edited wording" }]);
  const kept = updateEditableBatchSpecificationSuggestion(edited, "one", { selected: false });
  assert.deepEqual(selectedBatchSpecificationSuggestions(kept), []);
  assert.deepEqual(selectedBatchSpecificationSuggestions(updateEditableBatchSpecificationSuggestion(kept, "one", { selected: true })), [{ targetId: "one", specificationSuggestion: "Edited wording" }]);
});

test("empty or oversized edited values are excluded from apply", () => {
  assert.deepEqual(selectedBatchSpecificationSuggestions([{ targetId: "one", value: "   ", selected: true }]), []);
  assert.deepEqual(selectedBatchSpecificationSuggestions([{ targetId: "one", value: "x".repeat(1001), selected: true }]), []);
});
