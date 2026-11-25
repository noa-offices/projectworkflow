import assert from "node:assert/strict";
import test from "node:test";
import { priceConfiguration, priceModularItems, toQuotePrice, type QuotePriceInput } from "./configuration-price";
import { configurationPriceFixtures } from "./testing/configuration-price-fixtures";
import { mainBuilderPrice } from "./testing/main-builder-price";

const fixtures = configurationPriceFixtures();
const quoteContexts: Omit<QuotePriceInput, "buckets">[] = [
  { rates: {}, rule: "round_up_5_legacy" },
  { rates: { EUR: 3.97, USD: 3.673 }, rule: "round_up_5_legacy", announced: { percent: 3, checked: true } },
  { rates: { EUR: 4.18, USD: 3.68 }, rule: "whole_aed_v1", announced: { percent: 3, checked: false } },
  { rates: { EUR: "4.18", USD: "0" }, rule: "whole_aed_v1", announced: { percent: -2.5, checked: true } },
  { rates: { EUR: 4, USD: 3.67 }, rule: "whole_aed_v1", announced: { percent: 3, checked: true }, override: 79.99 },
];

test(`${fixtures.length} builder selections match main across ${fixtures.length * quoteContexts.length} quote scenarios`, () => {
  for (const { name, input, modular } of fixtures) {
    const actual = priceConfiguration({
      ...input,
      configuration: { ...input.configuration, modularItems: priceModularItems(modular.groups, modular.quantities, input.configuration.selectedFabricCategory) },
    });
    for (const quote of quoteContexts) {
      const expected = mainBuilderPrice(input, quote, modular);
      const actualQuote = toQuotePrice({ ...quote, buckets: actual.buckets });
      assert.deepEqual(actual.buckets, expected.buckets, name + " buckets");
      assert.deepEqual(actual.lines, expected.lines, name + " lines");
      assert.deepEqual(actual.linked, expected.linked, name + " linked lines");
      assert.deepEqual(actual.derivedDesking, expected.derivedDesking, name + " workstation lines");
      assert.equal(actual.selectedCategoryPrice, expected.selectedCategoryPrice, name + " matrix cell");
      assert.equal(actual.matchingLinkedProductTotal, expected.matchingLinkedProductTotal, name + " matching linked total");
      assert.equal(actual.hasMixedAccessoryCurrencies, expected.hasMixedAccessoryCurrencies, name + " mixed accessory currencies");
      assert.equal(actual.hasMixedLinkedProductCurrencies, expected.hasMixedLinkedProductCurrencies, name + " mixed linked currencies");
      assert.equal(actual.status, expected.status, name + " status");
      assert.deepEqual(actual.reasons, expected.reasons, name + " reasons");
      assert.deepEqual(actualQuote, expected.quote, name + " quote");
      assert.equal(actual.status === "needs" || actualQuote.missingExchangeRate, expected.addBlocked, name + " add gate");
    }
  }
});

test("Oxi_L and Oxi_R keep the four reported Universal Screen prices", () => {
  for (const parent of ["Oxi_L", "Oxi_R"]) {
    for (const [selection, base] of [["s1-l100", 62], ["cat-b", 138], ["cat-c", 140]] as const) {
      const fixture = fixtures.find(({ name }) =>
        name.startsWith(parent + " screen ") && name.includes(selection) && name.endsWith("x undefined, add true, other brand false"));
      assert.ok(fixture, `${parent} ${selection}`);
      const result = priceConfiguration(fixture.input);
      assert.equal(result.linked[0].unitPrice, base);
      assert.equal(result.lines.linkedAccessorySummary[0].unitPrice, 35);
      assert.equal(result.linked[0].accessoryTotal, 57.375);
      assert.deepEqual([...result.buckets.originalCurrencyTotals], [["AED", 250.125], ["EUR", base * 2 + 115], ["USD", 12.375]]);
    }
  }
});
