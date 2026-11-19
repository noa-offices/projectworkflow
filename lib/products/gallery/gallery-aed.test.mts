import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { galleryAed, galleryAedView } from "./gallery-aed";
import type { GalleryPriceState } from "./gallery-price-view";

const eur = { currency: "EUR", amount: 10 };
const usd = { currency: "USD", amount: 5 };
const aed = { currency: "AED", amount: 12.25 };
const rates = { EUR: 4.25, USD: 3.67 };
// The price-check block is independent of the AED estimate.
const priced = { status: "priced", sourceTotals: [eur] } as GalleryPriceState;

test("single-currency and mixed estimates use whole-AED rounding once for the total", () => {
  assert.deepEqual(galleryAed([eur], rates), { lines: [{ ...eur, aed: 43 }], totalAed: 43, missing: [] });
  assert.deepEqual(galleryAed([eur, usd], rates), {
    lines: [{ ...eur, aed: 43 }, { ...usd, aed: 18 }], totalAed: 61, missing: [],
  });
  assert.equal(galleryAed([{ ...eur, amount: 1 }, { ...usd, amount: 1 }], { EUR: 4.4, USD: 3.4 }).totalAed, 8);
  assert.equal(galleryAed([{ ...eur, amount: 1 }], { EUR: 4.49 }).totalAed, 4);
});

test("AED passes through unchanged and missing rates permit partial lines only", () => {
  assert.deepEqual(galleryAed([aed], {}), { lines: [{ ...aed, aed: 12.25 }], totalAed: 12.25, missing: [] });
  assert.deepEqual(galleryAed([eur, usd, aed], { EUR: 4.25 }), {
    lines: [{ ...eur, aed: 43 }, usd, { ...aed, aed: 12.25 }], totalAed: undefined, missing: ["USD"],
  });
});

test("card and popup use the default rate, prefer a temporary one and handle missing access", () => {
  assert.deepEqual(galleryAedView(priced, rates, {}), {
    amounts: ["≈ AED 43"], notes: ["1 EUR = 4.25 AED (default)"], missing: [], noRate: false,
  });
  assert.deepEqual(galleryAedView(priced, rates, { EUR: 4 }), {
    amounts: ["≈ AED 40"], notes: ["1 EUR = 4 AED (your temporary rate)"], missing: [], noRate: false,
  });
  assert.deepEqual(galleryAedView(priced, {}, {}), {
    amounts: [], notes: [], missing: ["EUR"], noRate: true,
  });
  const mixed = { status: "priced", sourceTotals: [eur, usd] } as GalleryPriceState;
  assert.deepEqual(galleryAedView(mixed, { EUR: 4.25 }, {}), {
    amounts: ["EUR ≈ AED 43"], notes: ["1 EUR = 4.25 AED (default)"], missing: ["USD"], noRate: false,
  });
  assert.equal(galleryAedView(undefined, rates, { EUR: 4 }), null);
  assert.equal(galleryAedView("loading", rates, {}), null);
});

test("temporary rates are role gated and use only component state, with one batch read", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const browser = read("../../../components/products/product-gallery-browser.tsx");
  const popover = read("../../../components/products/product-gallery-rate-popover.tsx");
  const price = read("../../../components/products/product-gallery-price.tsx");
  const actions = read("./currency-default-rates-actions.ts");
  const settings = read("../../../components/settings/currency-rates-card.tsx");
  assert.match(browser, /\{canSeePrices \? \(\s*<ProductGalleryRatePopover/);
  assert.match(browser, /\[temporaryRates, setTemporaryRates\] = useState<CurrencyRates>\(EMPTY_RATES\)/);
  assert.match(browser, /const onRefresh = \(\) => \{\s*setTemporaryRates\(EMPTY_RATES\)/);
  assert.equal((browser.match(/listCurrencyDefaultRatesAction\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(browser, /localStorage|sessionStorage|document\.cookie|setCurrencyDefaultRateAction|removeCurrencyDefaultRateAction/);
  assert.doesNotMatch(popover, /localStorage|sessionStorage|document\.cookie|fetch\(|sendBeacon|Action|history\.|location\.|useRouter/);
  assert.match(browser, /onRate=\{\(currency, rate\) => setTemporaryRates\(\(current\) => \(\{ \.\.\.current, \[currency\]: rate \}\)\)\}/);
  assert.match(browser, /onReset=\{\(\) => setTemporaryRates\(EMPTY_RATES\)\}/);
  for (const source of [browser, popover, price, actions, settings]) {
    assert.doesNotMatch(source, /createAdminClient|supabase\/admin|service_role/i);
  }
});
