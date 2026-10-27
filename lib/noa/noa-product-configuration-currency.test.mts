// Golden tests for converting a COMPLETED Product Configuration source unit price to AED with a user-typed rate.
// Zero live calls: the template loader is a fixture, the AI runtime is disabled by the golden harness, the database throws if touched.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { installNoaGoldenFixtures } from "./testing/noa-golden-harness";
installNoaGoldenFixtures(mock);

const completeTemplate = (id: string, currency: string, price: number) => ({ id, templateName: "MONOLITH", currency, defaultUnitPrice: price });
const incompleteTemplate = {
  id: "incomplete", templateName: "MONOLITH", currency: "EUR", defaultUnitPrice: 764,
  variantPricing: [{ id: "grp1", pricing_type: "base_model_group", group_name: "Models", is_active: true, sort_order: 0, items: [
    { id: "r1", display_name: "1800x900", price: 500, is_active: true, sort_order: 0 },
    { id: "r2", display_name: "2000x1000", price: 600, is_active: true, sort_order: 1 },
  ] }],
};
const templates: Record<string, unknown> = {
  eur: completeTemplate("eur", "EUR", 764), usd: completeTemplate("usd", "USD", 764), aed: completeTemplate("aed", "AED", 764), incomplete: incompleteTemplate,
};
mock.module("@/lib/products/product-configuration-loader.server", { namedExports: {
  loadProductConfigurationTemplate: async (id: string) => templates[id] ? { ok: true, template: templates[id] } : { ok: false, reason: "not_found" },
} });

let priceCapabilityCalls = 0;
mock.module("@/lib/noa/noa-price-capability.server", { namedExports: { fetchNoaPriceCapability: async () => { priceCapabilityCalls += 1; return { ok: false, message: "price capability fixture", reason: "not_found" }; } } });
const { runNoaOrchestrator } = await import("./noa-orchestrator");
const {
  convertConfiguredPrice, convertToAedMinorUnits, formatAedMinorUnits, isBareRateMessage, isCurrencyConversionMessage, parseConversionRate,
} = await import("./noa-product-configuration-currency");

const context = { pathname: "/products", section: "other" as const };
type Reference = { templateId: string; mode: "configuring"; selections: Record<string, unknown> };
async function turn(message: string, reference: Reference | undefined) {
  const answer = await runNoaOrchestrator({ context, message, recentMessages: [], productConfigurationReference: reference } as never);
  return answer as { text: string; domain?: string; sources: unknown[]; productConfigurationReference?: Reference };
}
const start = (templateId: string): Reference => ({ templateId, mode: "configuring", selections: {} });
const isConverted = (text: string) => /Rate used/.test(text) && /Converted: AED/.test(text);

test("a. EUR 764: 'convert price to AED' asks for the rate, then '4.05' returns AED 3,094.20 with the rate and the disclaimer", async () => {
  const asked = await turn("convert price to AED", start("eur"));
  assert.match(asked.text, /EUR 764/); assert.match(asked.text, /What EUR to AED rate/); assert.equal(isConverted(asked.text), false);
  assert.deepEqual(asked.productConfigurationReference, start("eur"), "the reference continues the flow");
  assert.equal(asked.domain, "Product"); assert.deepEqual(asked.sources, []);
  const converted = await turn("4.05", asked.productConfigurationReference);
  assert.match(converted.text, /AED 3,094\.20/); assert.match(converted.text, /4\.05/); assert.match(converted.text, /does not include markup, discount or VAT/);
  assert.deepEqual(converted.productConfigurationReference, start("eur"));
});

test("b. 'convert to AED at 4.05' converts in one message; 'rate 4.05' and 'at 4.05' work as bare rates", async () => {
  assert.match((await turn("convert to AED at 4.05", start("eur"))).text, /AED 3,094\.20/);
  assert.match((await turn("rate 4.05", start("eur"))).text, /AED 3,094\.20/);
  assert.match((await turn("at 4.05", start("eur"))).text, /AED 3,094\.20/);
});

test("c. invalid rates never convert", async () => {
  for (const message of ["convert to AED at 0", "0", "500", "convert to AED at 500", "convert to aed abc", "abc"]) {
    const answer = await turn(message, start("eur"));
    assert.equal(isConverted(answer.text), false, message);
  }
  const zero = await turn("0", start("eur"));
  assert.match(zero.text, /not a valid rate/); assert.match(zero.text, /What EUR to AED rate/);
  assert.match((await turn("convert to AED at 100", start("eur"))).text, /AED 76,400\.00/, "100 is inside the range");
  assert.match((await turn("convert to AED at 0.01", start("eur"))).text, /AED 7\.64/, "0.01 is inside the range");
});

test("d. USD converts the same way; a price already in AED says so and never asks for a rate", async () => {
  const usd = await turn("convert to AED at 3.67", start("usd"));
  assert.match(usd.text, /USD 764/); assert.match(usd.text, /AED 2,803\.88/);
  assert.match((await turn("convert price to AED", start("usd"))).text, /What USD to AED rate/);
  const aed = await turn("convert to AED at 4.05", start("aed"));
  assert.match(aed.text, /already in AED/); assert.equal(isConverted(aed.text), false);
});

test("e. mixed or other-currency prices are not supported yet (decision level)", () => {
  assert.deepEqual(convertConfiguredPrice({ currency: "EUR", unit: 764, missingExchangeRateCurrencies: ["USD"] }, "convert to AED at 4.05"), { kind: "unsupported" });
  assert.deepEqual(convertConfiguredPrice({ currency: "GBP", unit: 100, missingExchangeRateCurrencies: [] }, "convert to AED at 4.05"), { kind: "unsupported" });
  assert.deepEqual(convertConfiguredPrice({ currency: "AED", unit: 100, missingExchangeRateCurrencies: ["USD"] }, "4.05"), { kind: "unsupported" }, "mixed wins over already-AED");
});

test("f. regression: price questions keep their old routing, specification and summary keep their answers, and nothing converts while the configuration is incomplete", async () => {
  // Today a message containing "price" routes as a fresh Price question (the Price capability), even after completion. That must not change.
  priceCapabilityCalls = 0;
  const price = await turn("what is the price", start("eur"));
  assert.equal(priceCapabilityCalls, 1, "still answered by the Price capability"); assert.equal(isConverted(price.text), false);
  assert.deepEqual(price.productConfigurationReference, start("eur"), "the wrapper still re-attaches the reference");
  const specification = await turn("final specification", start("eur"));
  assert.equal(isConverted(specification.text), false); assert.doesNotMatch(specification.text, /^Configured source unit price/);
  const summary = await turn("summary", start("eur"));
  assert.match(summary.text, /Configured source unit price/); assert.equal(isConverted(summary.text), false);
  // Incomplete configuration: a bare number is just an answer to the pending question, and "convert price to AED" is still a fresh Price question.
  const bare = await turn("4.05", start("incomplete"));
  assert.equal(isConverted(bare.text), false); assert.doesNotMatch(bare.text, /What EUR to AED rate/);
  priceCapabilityCalls = 0;
  const midFlow = await turn("convert price to AED", start("incomplete"));
  assert.equal(priceCapabilityCalls, 1, "not consumed as a conversion while a step is pending"); assert.equal(isConverted(midFlow.text), false);
});

test("classifier and arithmetic helpers", () => {
  for (const yes of ["convert to aed", "Convert price to AED", "in dirham", "4.05", "rate 4.05", "at 4.05", "at rate 4.05"]) assert.equal(isCurrencyConversionMessage(yes), true, yes);
  for (const no of ["what is the price", "summary", "final specification", "4.05 chairs", "abc"]) assert.equal(isCurrencyConversionMessage(no), false, no);
  assert.equal(isBareRateMessage("4.05"), true); assert.equal(isBareRateMessage("rate"), false);
  assert.deepEqual(parseConversionRate("at 4.05 please"), { status: "valid", text: "4.05" });
  assert.deepEqual(parseConversionRate("none here"), { status: "none" });
  assert.deepEqual(parseConversionRate("0.009"), { status: "invalid" }); assert.deepEqual(parseConversionRate("100.01"), { status: "invalid" });
  assert.equal(convertToAedMinorUnits(764, "4.05"), 309420); assert.equal(formatAedMinorUnits(309420), "3,094.20");
  assert.equal(convertToAedMinorUnits(0.1, "3"), 30); assert.equal(convertToAedMinorUnits(19.99, "3.6725"), 7341); // 19.99 x 3.6725 = 73.41 (cents, round half up)
});
