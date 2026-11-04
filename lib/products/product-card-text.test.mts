import assert from "node:assert/strict";
import test from "node:test";
import { brandAndCategoryLine, oneLineText, templateCodeLine } from "./product-card-text.js";

test("brand and category are joined on one line, and missing parts are left out", () => {
  assert.equal(brandAndCategoryLine("LAS MOBILI", ["Desk", "Executive Desk"]), "LAS MOBILI · Desk / Executive Desk");
  assert.equal(brandAndCategoryLine("Arca", ["Chairs", null]), "Arca · Chairs");
  assert.equal(brandAndCategoryLine("Arca", [null, undefined, " "]), "Arca");
  assert.equal(brandAndCategoryLine("Arca", ["Desk / Executive Desk"]), "Arca · Desk / Executive Desk");
});

test("an empty code or description gives nothing, not a placeholder", () => {
  assert.equal(templateCodeLine(null, ""), null);
  assert.equal(templateCodeLine("T-1", null), "T-1");
  assert.equal(templateCodeLine("T-1", "I-9"), "T-1 / I-9");
  assert.equal(oneLineText(null, "  "), null);
  assert.equal(oneLineText("", "Spec text"), "Spec text");
  assert.equal(oneLineText("Line one\n  line two"), "Line one line two");
});
