import assert from "node:assert/strict";
import test from "node:test";
import { moveDecision } from "./material-move";

const codes = (...values: string[]) => new Set(values.map((value) => value.trim().toLowerCase()));

test("a code already active in the target sub-group blocks the move (case and spaces ignored)", () => {
  assert.equal(moveDecision({ code: " A01 ", isActive: true, subgroupId: "x" }, "t", codes("a01")), "duplicate");
  assert.equal(moveDecision({ code: "A02", isActive: true, subgroupId: "x" }, "t", codes("a01")), "ok");
});

test("empty codes, moving out of every sub-group, and a material already in the target never collide", () => {
  assert.equal(moveDecision({ code: "", isActive: true, subgroupId: "x" }, "t", codes("")), "ok");
  assert.equal(moveDecision({ code: "A01", isActive: true, subgroupId: "x" }, null, codes("a01")), "ok");
  assert.equal(moveDecision({ code: "A01", isActive: true, subgroupId: "t" }, "t", codes("a01")), "ok");
});
