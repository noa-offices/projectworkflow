import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-orchestrator.ts has "server-only" + "@/..." aliases, neither resolvable by Node's plain ESM
// resolver outside the Next.js build. Source-level wiring/safety checks, same convention as every
// other lib/noa/*-safety.test.mts file. noa-product-capability.server.ts and
// noa-price-capability.server.ts are read here only to confirm C4D did NOT need to touch either
// (both already re-derive their target/classification from raw message text via their own
// stopword-based extractSearchTerm(), mirroring C4A's Quotation and C4C's Procurement findings).

const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const productCapabilitySource = readFileSync("lib/noa/noa-product-capability.server.ts", "utf8");
const priceCapabilitySource = readFileSync("lib/noa/noa-price-capability.server.ts", "utf8");
const conversationReferenceSource = readFileSync("lib/noa/noa-conversation-reference.ts", "utf8");

// ── Product semantic wiring (tests 1-4) ─────────────────────────────────────────

test("Product capability was not touched - it already re-derives detail/list/target from raw message text via its own stopword-based extractSearchTerm", () => {
  assert.ok(productCapabilitySource.includes("export async function fetchNoaProductCapability("));
  assert.ok(!productCapabilitySource.includes("semanticRequest"));
  assert.ok(!productCapabilitySource.includes("conversationReference"));
});

test("a confident Product-domain classification reroutes an otherwise-unresolved Help message - no intent gate, matching the C4A/B/C shape", () => {
  assert.match(orchestratorSource, /if \(!semanticRequest && extracted\.domain === "Product"\) \{\s*\n\s*semanticRequest = \{ domain: "Product", intent: extracted\.intent \};/);
});

test("the Product reroute only ever fires for the Help/unresolved fallback path", () => {
  const triggerIndex = orchestratorSource.indexOf('if (!recordedQuotationFollowUpFrom && (route === "UserActivity" || route === "Help"))');
  const productCheckIndex = orchestratorSource.indexOf('extracted.domain === "Product"');
  assert.ok(triggerIndex >= 0 && productCheckIndex >= 0 && triggerIndex < productCheckIndex);
});

test("the Product capability is always dispatched with the rewritten-or-original message", () => {
  assert.match(orchestratorSource, /domain === "Product"\s*\n\s*\? await fetchNoaProductCapability\(productMessageOverride \?\? request\.message, request\.context\)/);
});

// ── Product follow-up / reference (test 5) ──────────────────────────────────────

test("resolveProductFollowUp only fires against a Product-domain conversationReference carrying exactly one product entity - never a multi-item list reference", () => {
  const fnStart = orchestratorSource.indexOf("function resolveProductFollowUp");
  const fnEnd = orchestratorSource.indexOf("\n// C4D: builds a bounded Product conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('if (reference.domain !== "Product") return undefined;'));
  assert.ok(fnBody.includes("productEntities.length !== 1"));
});

test("a Product follow-up rewrites the message to a canonical 'product <label>' form and always re-dispatches through the unchanged capability - the provider still sees the original message", () => {
  const fnStart = orchestratorSource.indexOf("function resolveProductFollowUp");
  const fnEnd = orchestratorSource.indexOf("\n// C4D: builds a bounded Product conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("`product ${productLabel}`"));
  assert.match(orchestratorSource, /const \{ text \} = await runNoaProvider\(\{\s*\n\s*capabilityData: capabilityResult\.data,\s*\n\s*context: request\.context,\s*\n\s*displayName: request\.displayName,\s*\n\s*domain,\s*\n\s*message: originalMessage,/);
  // I3: originalMessage is captured before any capability-only message substitution.
  assert.ok(orchestratorSource.includes("const originalMessage = request.message;"));
});

test("buildProductConversationReference reads only the safe name field from the array-shaped detail result or the product_list rows - never id/UUID", () => {
  const fnStart = orchestratorSource.indexOf("function buildProductConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4D: resolves a pronoun-only Price follow-up", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes(".name"));
  assert.ok(!/\.id\b/.test(fnBody));
  assert.ok(fnBody.includes("boundConversationReferenceEntities("));
});

// ── Price semantic wiring (tests 6-8) ───────────────────────────────────────────

test("Price capability was not touched - it already re-derives detail/list/summary and target extraction from raw message text via its own extractSearchTerm", () => {
  assert.ok(priceCapabilitySource.includes("export async function fetchNoaPriceCapability("));
  assert.ok(!priceCapabilitySource.includes("semanticRequest"));
  assert.ok(!priceCapabilitySource.includes("conversationReference"));
});

test("a confident Price-domain classification reroutes an otherwise-unresolved Help message - checked after the Product domain check, so Product/Price never collapse into one domain", () => {
  assert.match(orchestratorSource, /if \(!semanticRequest && extracted\.domain === "Price"\) \{\s*\n\s*semanticRequest = \{ domain: "Price", intent: extracted\.intent \};/);
  const productDomainIndex = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Product")');
  const priceDomainIndex = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Price")');
  assert.ok(productDomainIndex >= 0 && priceDomainIndex >= 0 && productDomainIndex < priceDomainIndex);
});

test("the Price capability is always dispatched with the rewritten-or-original message", () => {
  assert.match(orchestratorSource, /: await fetchNoaPriceCapability\(productMessageOverride \?\? request\.message, request\.context\);/);
});

// ── Price follow-up / reference (test 9) ────────────────────────────────────────

test("resolveProductPriceFollowUp only fires against a Price-domain conversationReference carrying exactly one product entity", () => {
  const fnStart = orchestratorSource.indexOf("function resolveProductPriceFollowUp");
  const fnEnd = orchestratorSource.indexOf("\n// C4D: builds a bounded Price conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('if (reference.domain !== "Price") return undefined;'));
  assert.ok(fnBody.includes("productEntities.length !== 1"));
  assert.ok(fnBody.includes("`price status ${productLabel}`"));
});

test("buildPriceConversationReference reads only name/brand - never templateId/UUID, statusKey, statusLabel, or counts", () => {
  const fnStart = orchestratorSource.indexOf("function buildPriceConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4A: builds a bounded Quotation conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("record.name"));
  assert.ok(fnBody.includes("record.brand"));
  assert.ok(!/templateId|statusKey|statusLabel|\bcounts\b/.test(fnBody));
  assert.ok(fnBody.includes("boundConversationReferenceEntities("));
});

// ── Product vs Price distinction (tests 10-13, covered structurally) ───────────

test("the Product and Price follow-up/reroute checks are independently gated on their own domain - a stale Product reference can never answer a Price follow-up and vice versa", () => {
  const productFollowUpIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Product")');
  const priceFollowUpIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Price")');
  assert.ok(productFollowUpIndex >= 0 && priceFollowUpIndex >= 0 && productFollowUpIndex < priceFollowUpIndex);
});

// ── Security preservation (tests 14-16) ─────────────────────────────────────────

test("Product authorization is untouched: requireProductLibraryManager() remains the single auth gate", () => {
  assert.ok(productCapabilitySource.includes("await requireProductLibraryManager();"));
});

test("Price authorization is untouched: requireProductLibraryManager() remains the single auth gate", () => {
  assert.ok(priceCapabilitySource.includes("await requireProductLibraryManager();"));
});

test("no semantic/reference logic ever calls an auth gate - authorization only happens inside each capability's own dispatch", () => {
  const beforeDispatch = orchestratorSource.slice(0, orchestratorSource.indexOf("export async function runNoaOrchestrator"));
  assert.ok(!/requireProductLibraryManager/.test(beforeDispatch));
});

// ── Reference safety (tests 17-18) ──────────────────────────────────────────────

test("no UUID/internal pricing data (raw price JSON, template id) ever appears in a Product reference entity", () => {
  const fnStart = orchestratorSource.indexOf("function buildProductConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4D: resolves a pronoun-only Price follow-up", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(!/\.id\b|unitPrice|material_suggestions/.test(fnBody));
});

test("no price amount/status count is ever stored as an authoritative reference fact for Price", () => {
  const fnStart = orchestratorSource.indexOf("function buildPriceConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4A: builds a bounded Quotation conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(!/statusKey|statusLabel|counts|unitPrice|default_unit_price/.test(fnBody));
});

// ── Regression (tests 19-22) ────────────────────────────────────────────────────

test("regression: Quotation/Project/Client/Procurement reference checks and domain checks still run strictly before the new Product/Price checks", () => {
  const quotationDomainIndex = orchestratorSource.indexOf('if (!semanticRequest && extracted.domain === "Quotation")');
  const projectRefIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Project")');
  const clientRefIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Client")');
  const procurementRefIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Procurement")');
  const productRefIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Product")');
  const priceRefIndex = orchestratorSource.indexOf('if (!semanticRequest && conversationReference?.domain === "Price")');
  assert.ok([quotationDomainIndex, projectRefIndex, clientRefIndex, procurementRefIndex, productRefIndex, priceRefIndex].every((i) => i >= 0));
  assert.ok(quotationDomainIndex < projectRefIndex);
  assert.ok(projectRefIndex < clientRefIndex);
  assert.ok(clientRefIndex < procurementRefIndex);
  assert.ok(procurementRefIndex < productRefIndex);
  assert.ok(productRefIndex < priceRefIndex);
});

test("regression: Quotation/Project/Client/Procurement/UserActivity dispatch branches are untouched", () => {
  assert.match(orchestratorSource, /: domain === "Quotation"\s*\n\s*\? await fetchNoaQuotationCapability\(request\.message, request\.context\)/);
  assert.match(orchestratorSource, /: domain === "Project"\s*\n\s*\? await fetchNoaProjectCapability\(projectMessageOverride \?\? request\.message, request\.context\)/);
  assert.match(orchestratorSource, /: domain === "Client"\s*\n\s*\? await fetchNoaClientCapability\(clientMessageOverride \?\? request\.message, request\.context\)/);
  assert.match(orchestratorSource, /: domain === "Procurement"\s*\n\s*\? await fetchNoaProcurementCapability\(procurementMessageOverride \?\? request\.message, request\.context\)/);
  assert.ok(orchestratorSource.includes("await fetchNoaUserActivityCapability(request.message, request.context, {"));
});

test("regression: Admin/Insights dispatch branches are untouched", () => {
  assert.ok(orchestratorSource.includes("await fetchNoaAdminCapability(request.message, request.context)"));
  assert.ok(orchestratorSource.includes("await fetchNoaInsightsCapability(request.message, request.context)"));
});

test("regression: greeting/capabilities/context routes still return before any semantic extraction/capability dispatch", () => {
  // A later, external change (predating GPC-3) moved conversationReference PARSING earlier in the
  // function (now alongside route classification) - parsing alone is harmless (it never performs
  // a business action), so the safety property this test actually guards - greeting/capabilities/
  // context never reach the semantic extractor or a capability call - is checked directly instead.
  const greetingIndex = orchestratorSource.indexOf('if (route === "greeting")');
  const capabilitiesIndex = orchestratorSource.indexOf('if (route === "capabilities")');
  const contextIndex = orchestratorSource.indexOf('if (route === "context")');
  const extractorCallIndex = orchestratorSource.indexOf("await extractNoaSemanticRequest(");
  assert.ok(contextIndex < extractorCallIndex && greetingIndex < extractorCallIndex && capabilitiesIndex < extractorCallIndex);
});

// ── Reference type unchanged ─────────────────────────────────────────────────────

test("no new fields were added to NoaConversationReference for Product/Price - the existing bounded shape is reused as-is", () => {
  assert.ok(!conversationReferenceSource.includes("templateId"));
  assert.ok(!conversationReferenceSource.includes("brandId"));
});

// ── Cost/token control (test 23) ────────────────────────────────────────────────

test("still exactly one extractor invocation per request after C4D", () => {
  const count = (orchestratorSource.match(/extractNoaSemanticRequest\(/g) ?? []).length;
  assert.equal(count, 1);
});

test("no recentMessages/capabilityData/Product-or-Price rows sent to the extractor", () => {
  const callMatch = orchestratorSource.match(/extractNoaSemanticRequest\(([^)]*)\)/);
  assert.ok(callMatch);
  assert.match(callMatch[1], /^\{ context: request\.context, message: request\.message \}$/);
});

test("no mutation calls or cross-capability chaining were introduced", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;
  assert.ok(!mutationPattern.test(orchestratorSource.slice(orchestratorSource.indexOf("function resolveProductFollowUp"))));
});
