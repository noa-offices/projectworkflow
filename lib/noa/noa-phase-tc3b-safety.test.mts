import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const semantic = readFileSync("lib/noa/noa-semantic-request.ts", "utf8");
const extractor = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const product = readFileSync("lib/noa/noa-product-capability.server.ts", "utf8");
const price = readFileSync("lib/noa/noa-price-capability.server.ts", "utf8");

test("TC-3B keeps the Product candidate compact and fact-free in the provider schema", () => {
  assert.ok(semantic.includes("export type NoaSemanticProduct"));
  assert.ok(extractor.includes("productText: { type: \"string\", maxLength: 160 }"));
  assert.ok(extractor.includes("brandText: { type: \"string\", maxLength: 160 }"));
  assert.ok(extractor.includes("categoryText: { type: \"string\", maxLength: 160 }"));
  assert.ok(!extractor.includes("productTemplateId"));
  assert.ok(!extractor.includes("capabilityData"));
});

test("TC-3B dispatches Product and Price candidates only after their existing domain routing", () => {
  assert.ok(orchestrator.includes('extracted.domain === "Product"'));
  assert.ok(orchestrator.includes('extracted.domain === "Price"'));
  assert.ok(orchestrator.includes('fetchNoaProductCapability(productMessageOverride ?? request.message, request.context, semanticRequest?.domain === "Product"'));
  assert.ok(orchestrator.includes('fetchNoaPriceCapability(productMessageOverride ?? request.message, request.context, semanticRequest?.domain === "Price"'));
});

test("TC-3B reuses bounded brand/category matching and preserves independent capability auth", () => {
  for (const capability of [product, price]) {
    assert.ok(capability.includes("await requireProductLibraryManager();"));
    assert.ok(capability.includes("product?.brandText"));
    assert.ok(capability.includes("product?.categoryText"));
    assert.ok(capability.includes("options?.product?.productText"));
    assert.ok(capability.includes('reason: "ambiguous"'));
  }
});
