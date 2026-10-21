import assert from "node:assert/strict";
import test from "node:test";
import { compareSubgroups, sortMaterials } from "./material-sort";

const item = (code: string, name = "x", createdAt?: string) => ({ code, createdAt, name });
const codes = (items: Array<{ code: string }>) => items.map((entry) => entry.code);

test("code order is numeric: 10 before 522", () => {
  assert.deepEqual(codes(sortMaterials([item("522"), item("10"), item("9")], "code")), ["9", "10", "522"]);
});

test("mixed codes use natural order: A2 before A10", () => {
  assert.deepEqual(codes(sortMaterials([item("A10"), item("a2"), item("A1")], "code")), ["A1", "a2", "A10"]);
});

test("empty codes go to the end, ordered by name", () => {
  const sorted = sortMaterials([item("", "Zed"), item("5", "Five"), item("", "Alpha"), item("  ", "Mid")], "code");
  assert.deepEqual(sorted.map((entry) => entry.name), ["Five", "Alpha", "Mid", "Zed"]);
});

test("name order is natural with the code as tie-breaker", () => {
  const sorted = sortMaterials([item("2", "Grey 10"), item("1", "Grey 2"), item("9", "Grey 2")], "name");
  assert.deepEqual(sorted.map((entry) => `${entry.code}:${entry.name}`), ["1:Grey 2", "9:Grey 2", "2:Grey 10"]);
});

test("recently added puts the newest first and undated rows last", () => {
  const sorted = sortMaterials([item("1", "a", "2026-01-01"), item("2", "b"), item("3", "c", "2026-03-01")], "recent");
  assert.deepEqual(codes(sorted), ["3", "1", "2"]);
});

test("sub-groups: sort_order, then grade, then name (natural)", () => {
  const list = [
    { grade: "CAT B", name: "Time", sort_order: 0 },
    { grade: "CAT A", name: "Poli", sort_order: 0 },
    { grade: "CAT A", name: "Crepe 10", sort_order: 0 },
    { grade: "CAT A", name: "Crepe 2", sort_order: 0 },
    { grade: null, name: "Eco", sort_order: 1 },
  ];
  const sorted = [...list].sort(compareSubgroups).map((entry) => entry.name);
  assert.deepEqual(sorted, ["Crepe 2", "Crepe 10", "Poli", "Time", "Eco"]);
});
