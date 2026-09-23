import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Both capability files have "@/..." aliases and `import "server-only"` (not resolvable by
// Node's plain ESM resolver outside the Next.js build - `server-only` isn't even physically
// present in node_modules; Next.js provides it specially). These are source-level wiring/safety
// checks, not runtime execution tests, matching the established convention throughout lib/noa/'s
// other *-safety.test.mts files.

const productSource = readFileSync("lib/noa/noa-product-capability.server.ts", "utf8");
const priceSource = readFileSync("lib/noa/noa-price-capability.server.ts", "utf8");

const MUTATION_PATTERN = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;

// 1. Product capability contains requireProductLibraryManager()
test("1. Product capability still calls requireProductLibraryManager()", () => {
  assert.ok(productSource.includes('import { requireProductLibraryManager } from "@/lib/auth";'));
  assert.ok(productSource.includes("await requireProductLibraryManager();"));
});

// 2. Price capability contains requireProductLibraryManager()
test("2. Price capability still calls requireProductLibraryManager()", () => {
  assert.ok(priceSource.includes('import { requireProductLibraryManager } from "@/lib/auth";'));
  assert.ok(priceSource.includes("await requireProductLibraryManager();"));
});

// 3. neither uses createAdminClient
test("3. neither capability uses createAdminClient or a service-role client", () => {
  for (const source of [productSource, priceSource]) {
    assert.ok(!source.includes("createAdminClient"));
    assert.ok(!/service[-_]?role|SUPABASE_SERVICE_ROLE/i.test(source));
  }
});

// 4-7. no mutation calls introduced
test("4-7. neither capability introduces .insert(/.update(/.delete(/.upsert(", () => {
  for (const source of [productSource, priceSource]) {
    assert.ok(!MUTATION_PATTERN.test(source));
  }
});

// 8. broad Product list has a hard limit
test("8. broad Product list is hard-capped", () => {
  assert.match(productSource, /const BROAD_LIST_LIMIT = 20;/);
  assert.ok(productSource.includes(".limit(BROAD_LIST_LIMIT)"));
});

// 9. broad Price scan has a hard cap
test("9. broad Price scan is hard-capped and requires a narrowing filter", () => {
  assert.match(priceSource, /const BROAD_SCAN_LIMIT = 100;/);
  assert.ok(priceSource.includes(".limit(BROAD_SCAN_LIMIT)"));
  assert.match(priceSource, /if \(!brand && !categories\) \{\s*return \{/);
});

// 10. deterministicText exists in new broad result paths
test("10. every new broad Product/Price result path emits deterministicText", () => {
  assert.ok(productSource.includes('kind: "product_count",'));
  assert.ok(productSource.includes('kind: "product_list",'));
  const productDeterministicCount = (productSource.match(/deterministicText:/g) ?? []).length;
  assert.ok(productDeterministicCount >= 3, "expected deterministicText in count/empty-list/list result branches");

  assert.ok(priceSource.includes('kind: "price_list",'));
  assert.ok(priceSource.includes('kind: "price_summary",'));
  const priceDeterministicCount = (priceSource.match(/deterministicText:/g) ?? []).length;
  assert.ok(priceDeterministicCount >= 3, "expected deterministicText in list/summary/empty result branches");
});

// 11. Price continues to call productTemplatePriceCheckState()
test("11. Price capability still reuses productTemplatePriceCheckState() for every evaluated template, never a reimplementation", () => {
  assert.ok(priceSource.includes("productTemplatePriceCheckState,"));
  const callCount = (priceSource.match(/productTemplatePriceCheckState\(\{/g) ?? []).length;
  assert.equal(callCount, 2, "expected exactly two call sites: the existing detail path and the new broad-scan aggregation loop");
});

// Additional B1-specific safety -------------------------------------------------

test("broad Product filters use only real, authorized data - no invented category/brand aliases", () => {
  assert.ok(productSource.includes('.from("product_categories")'));
  assert.ok(productSource.includes('.from("brands")'));
  assert.ok(!/const\s+(CATEGORY|BRAND)_ALIASES/i.test(productSource));
});

test("broad Product/Price paths never select('*') and use fixed column lists", () => {
  for (const source of [productSource, priceSource]) {
    assert.ok(!source.includes('.select("*")'));
  }
});

test("price summary only reports the authoritative status keys already returned by productTemplatePriceCheckState()", () => {
  assert.match(priceSource, /"current", "needs_check", "due", "scheduled", "checked", "no_price_list_date"/);
});

test("broad price scan never silently extrapolates beyond what was actually scanned", () => {
  assert.ok(priceSource.includes("scanCapped"));
  assert.ok(priceSource.includes("showing price status for the first"));
});

test("existing quotation-snapshot-vs-live-price guard is preserved for detail-kind price questions", () => {
  assert.ok(priceSource.includes("context.quotationId && !context.productTemplateId"));
  assert.ok(priceSource.includes("fixed snapshot"));
});

test("existing single-template detail lookup paths are untouched (still short-circuit before broad dispatch)", () => {
  assert.ok(productSource.includes("if (context.productTemplateId) {"));
  assert.ok(productSource.includes("extractSearchTerm(message)"));
  assert.ok(priceSource.includes("if (context.productTemplateId) {"));
});
