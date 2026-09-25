import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const product = readFileSync("lib/noa/noa-product-capability.server.ts", "utf8");
const price = readFileSync("lib/noa/noa-price-capability.server.ts", "utf8");

test("TC-3B.1 resolves database-authoritative brand codes before names in Product and Price", () => {
  for (const capability of [product, price]) {
    assert.ok(capability.includes('select("id,name,code")'));
    assert.ok(capability.includes("brand.code?.trim().toLowerCase() === text"));
    assert.ok(capability.includes("messageMatchesCode(text, brand.code)"));
    assert.ok(capability.includes("messageMatchesName(text, brand.name)"));
  }
});

test("TC-3B.1 recognizes natural Price summaries without changing due-status evaluation", () => {
  assert.ok(price.includes("\\b(summarize|summary|overall|every|all|how many|count|number of)\\b"));
  assert.ok(price.includes("detectStatusAlias(normalizedMessage)"));
  assert.ok(price.includes("productTemplatePriceCheckState({"));
});

test("TC-3B.1 verifies generic Product candidates after auth and before AI fallback", () => {
  const authIndex = product.indexOf("await requireProductLibraryManager();");
  const queryIndex = product.indexOf('.from("product_templates")', authIndex);
  assert.ok(authIndex >= 0 && queryIndex > authIndex);
  assert.ok(product.includes("export async function resolveNoaProductCandidate"));
  assert.ok(product.includes("template_code.ilike"));
  assert.ok(product.includes("item_code.ilike"));
  const resolverIndex = orchestrator.indexOf("const productResolution = await resolveNoaProductCandidate");
  const extractorIndex = orchestrator.indexOf("await extractNoaSemanticRequest({");
  assert.ok(resolverIndex >= 0 && extractorIndex > resolverIndex);
  // I3: the Help-route V2 classifier call also runs only after the product candidate check.
  const helpV2Index = orchestrator.indexOf('if (!semanticRequest && route === "Help" && semanticV2Eligibility.eligible) {');
  assert.ok(helpV2Index > resolverIndex);
  assert.ok(orchestrator.includes('productResolution.kind === "ambiguous"'));
});

test("TC-3B.1 preserves identifier and Project/Client precedence", () => {
  assert.ok(orchestrator.includes("quotationIdentifierTotal > 0"));
  assert.ok(orchestrator.includes("projectFileIdentifierTotal > 0"));
  assert.ok(orchestrator.includes("const resolved = await resolveNoaEntityCandidate(genericEntityCandidate);"));
});
