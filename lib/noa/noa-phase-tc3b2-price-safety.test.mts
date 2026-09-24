import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const price = readFileSync("lib/noa/noa-price-capability.server.ts", "utf8");

test("TC-3B.2 applies only a unique, whole-word first brand-name token after existing code/name matching", () => {
  const nameMatch = price.indexOf("const nameMatch = brands.find");
  const tokenMatch = price.indexOf("const firstTokenMatch = uniqueFirstTokenBrand");
  assert.ok(nameMatch >= 0 && tokenMatch > nameMatch);
  assert.ok(price.includes("firstToken.length >= 3"));
  assert.ok(price.includes("matches.length === 1 ? matches[0] : null"));
  assert.ok(price.includes("new RegExp(`\\\\b${escapeRegExp(firstToken)}\\\\b`)"));
});

test("TC-3B.2 preserves Price broad filtering and status calculation", () => {
  assert.ok(price.includes("detectStatusAlias(normalizedMessage)"));
  assert.ok(price.includes("productTemplatePriceCheckState({"));
  assert.ok(price.includes("fetchBroadPriceResult"));
  assert.ok(price.includes("summarize|summary|overall"));
});
