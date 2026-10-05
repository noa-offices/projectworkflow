import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const inspector = await readFile(new URL("./supplier-source-inspector.tsx", import.meta.url), "utf8");
const familyReview = await readFile(new URL("./supplier-family-review.tsx", import.meta.url), "utf8");
const repository = await readFile(new URL("../../lib/products/supplier-price-repository.ts", import.meta.url), "utf8");

test("source inspector is read-only, source-scoped, searchable and exposes normalized evidence", () => {
  for (const text of ["View extracted data", "Extracted Supplier Data", "Close extracted Supplier data inspector", "× Close", "Search code", "Search article or Supplier code", "Clear", "Article code", "Supplier price", "Price field", "Dimension / tier", "Source rows", "Source evidence", "Full Supplier codes:", "Finish code:", "1 exact code match", "No extracted Supplier identity was found", "This code exists in the imported Supplier source"]) assert.ok(inspector.includes(text), text);
  assert.match(inspector, /supplier-source-inspector/); assert.doesNotMatch(inspector, /saveSupplier|applySupplier|deleteSupplier/);
  assert.match(familyReview, /Check source/); assert.match(familyReview, /supplier-source-inspector/);
  assert.match(inspector, /event\.key === "Escape"/); assert.match(inspector, /onSubmit/);
  assert.match(repository, /comparisonCode\(search\)/); assert.match(repository, /SupplierNormalizedWorkingRow/); assert.match(repository, /normalizedSupplierWorkingRow/); assert.match(repository, /\.eq\("source_id", source\.id\)/); assert.match(repository, /Math\.min\(inspectorLimit/); assert.match(repository, /rowKeys\.slice\(0, 5\)/);
});
