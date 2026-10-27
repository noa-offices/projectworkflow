import assert from "node:assert/strict";
import test from "node:test";
import { retainShownSelection } from "./supplier-review-selection";

test("selection starts empty and remains empty until the user selects rows", () => {
  const selected = new Set<string>();
  assert.deepEqual([...retainShownSelection(selected, ["A", "B"])], []);
});
test("filter and search changes retain only still-shown selected rows", () => {
  const selected = new Set(["A", "B", "C"]);
  assert.deepEqual([...retainShownSelection(selected, ["B", "D"])], ["B"]);
  assert.deepEqual([...selected], ["A", "B", "C"], "the prior selection is not mutated");
  assert.deepEqual([...retainShownSelection(selected, [])], []);
});
