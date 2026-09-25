import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveNoaSemanticCapabilityRequest } from "./noa-semantic-resolver.js";
import {
  UNCLEAR_SEMANTIC_REQUEST_V2,
  validateNoaSemanticRequestV2AgainstMessage,
  type NoaSemanticRequestV2,
} from "./noa-semantic-request.js";

const extractorSource = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
const productCapabilitySource = readFileSync("lib/noa/noa-product-capability.server.ts", "utf8");

function productList(entityText: string): NoaSemanticRequestV2 {
  return {
    ...UNCLEAR_SEMANTIC_REQUEST_V2,
    domain: "Product",
    entityType: "product",
    entityText,
    intent: "list",
    confidence: "high",
  };
}

test("V2 Product instruction requires the complete explicit brand-plus-qualifier phrase", () => {
  assert.ok(extractorSource.includes('keep the complete explicit search phrase together'));
  assert.ok(extractorSource.includes('retain a named brand and its adjacent product/category qualifier'));
  assert.ok(extractorSource.includes('"Interstuhl chairs" or "LAS desks"'));
  assert.ok(extractorSource.includes("A brand-only request remains brand-only."));
});

test("grounded Product qualifiers are preserved unchanged through the existing Product resolver", () => {
  for (const [message, entityText, canonicalMessage] of [
    ["Show me Interstuhl chairs", "Interstuhl chairs", "show Interstuhl chairs"],
    ["Show LAS desks", "LAS desks", "show LAS desks"],
    ["Do we have executive desks", "executive desks", "show executive desks"],
    ["Show Interstuhl", "Interstuhl", "show Interstuhl"],
  ]) {
    const request = productList(entityText);
    assert.equal(validateNoaSemanticRequestV2AgainstMessage(request, message), true, message);
    const resolution = resolveNoaSemanticCapabilityRequest(request);
    assert.equal(resolution.kind, "dispatch", message);
    if (resolution.kind !== "dispatch") continue;
    assert.deepEqual(
      { canonicalMessage: resolution.canonicalMessage, domain: resolution.domain, kind: resolution.kind },
      { canonicalMessage, domain: "Product", kind: "dispatch" },
      message,
    );
  }
});

test("the existing Product capability receives the canonical phrase as its search term", () => {
  assert.ok(productCapabilitySource.includes("const searchTerm = options?.product?.productText ?? extractSearchTerm(message);"));
});
