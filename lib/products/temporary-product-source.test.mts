import assert from "node:assert/strict";
import test from "node:test";
import { temporaryProductSourcePath } from "./temporary-product-source.js";

test("accepts only exact temporary source objects", () => {
  assert.equal(temporaryProductSourcePath("smart-source-qa/a.pdf"), "smart-source-qa/a.pdf");
  ["", "https://example.com/a.pdf", "../smart-source-qa/a.pdf", "product-images/a.webp", "product-source-files/a.pdf", "smart-source-qa/", "smart-source-qa/a/b.pdf", "smart-source-qa/../a.pdf"].forEach((path) => assert.equal(temporaryProductSourcePath(path), null));
});
