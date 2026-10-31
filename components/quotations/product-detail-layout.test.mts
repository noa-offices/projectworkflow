import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
const at = (text: string, from = 0) => { const index = source.indexOf(text, from); assert.ok(index >= 0, `not found: ${text}`); return index; };

const configuration = at("Configure size, pricing, accessories, linked items, and required selections.");
const cardTitle = at("Pricing and details");
const asideStart = at('<aside className="xl:sticky xl:top-24 xl:self-start">');
const asideEnd = at("</aside>", asideStart);
const materials = at("Materials &amp; Finishes".replace("&amp;", "&"), asideEnd);
const card = source.slice(cardTitle, asideStart);
const aside = source.slice(asideStart, asideEnd);

test("the new card sits after Configuration and before Materials & Finishes, in the left column", () => {
  assert.ok(configuration < cardTitle && cardTitle < materials);
  // It is inside the left column (before the right column starts), inside the add form, in the same card style as Configuration.
  assert.ok(at("action={addProductTemplateToQuotation}") < cardTitle && cardTitle < asideStart);
  assert.match(source.slice(cardTitle - 400, cardTitle), /<section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">/);
  assert.equal((source.match(/Pricing and details/g) ?? []).length, 1);
  assert.match(source.slice(asideStart - 300, asideStart), /<\/section>\s*<\/div>\s*$/, "the left column closes right before the right column");
});

test("the right column no longer holds the moved blocks and keeps the preview and the Add button", () => {
  for (const moved of ["Source Currency Total", "Currency Conversion", "to AED rate", "Pricing / Discount", "Discount Type", "Net Total:", "Final Specification", "final_specification_override", "FinalSpecificationAiControl", "Reset to product default", ">Dimensions<", ">Brand<", "Country of Origin", "Mixed-currency add-ons use the conversion rates below.", "Mixed-currency linked products use the conversion rates below."]) {
    assert.ok(!aside.includes(moved), `still in the right column: ${moved}`);
  }
  for (const kept of ["Add to Local Workspace", 'type="submit"', "pricingAccessorySummary", "nativeSystem", "PriceCheckBadge", "Mixed-currency advanced options should be reviewed manually."]) assert.ok(aside.includes(kept), `missing from the right column: ${kept}`);
  // The sticky footer with the Add button is unchanged.
  assert.match(aside, /<div className="sticky bottom-0 -mx-4 -mb-4 mt-1 border-t border-zinc-200 bg-white px-4 py-4">/);
  assert.ok(aside.indexOf("sticky bottom-0") < aside.indexOf("Add to Local Workspace"));
});

test("the card has every moved field: a Price group, and a Product details group that ends with the specification", () => {
  for (const moved of ["Source Currency Total", "Currency Conversion", "to AED rate", "Enter an exchange rate for", "Converted final:", "Pricing / Discount", "Discount Type", "Net Price:", "Net Total:", "Apply Updated Price", "Keep Current Quote Price",
    "Final Details", "Final Specification", 'name="final_specification_override"', "FinalSpecificationAiControl", "Reset to generated specification", "This only updates the current quotation item. Template specification stays unchanged.",
    "Dimensions", "Reset to product default", "Brand", "Country of Origin", "Mixed-currency add-ons use the conversion rates below.", "Mixed-currency linked products use the conversion rates below."]) assert.ok(card.includes(moved), `missing from the card: ${moved}`);
  // The yellow exchange rate box is the conversion block itself, next to the rate field.
  assert.match(card, /border-amber-200 bg-amber-50 p-3 text-left text-xs leading-5 text-amber-900/);
  const price = card.indexOf(">Price</p>"), details = card.indexOf(">Product details</p>");
  const dimensions = card.indexOf(">Dimensions</span>"), brand = card.indexOf(">Brand</span>"), origin = card.indexOf("Country of Origin");
  const specHeading = card.indexOf("Final Specification</p>"), textarea = card.indexOf('name="final_specification_override"');
  assert.ok(price > 0 && price < details, "Price comes first");
  assert.ok(card.indexOf("Source Currency Total") > price && card.indexOf("Pricing / Discount") < details);
  // Order inside Product details = visual order = keyboard order: Dimensions, Brand, Country of Origin, then the Specification.
  assert.ok(details < dimensions && dimensions < brand && brand < origin && origin < specHeading && specHeading < textarea, "Dimensions, Brand, Country of Origin, Specification");
  assert.ok(card.indexOf("Reset to product default") > dimensions && card.indexOf("Reset to product default") < brand, "Reset sits with Dimensions");
  // The specification belongs to the Product details group: no separate full-width block and no third group.
  assert.doesNotMatch(card, /lg:col-span-2/, "no separate full-width specification block remains");
  assert.equal((card.slice(details).match(/className="min-w-0 space-y-3"/g) ?? []).length, 0, "no group starts after Product details");
  // It fills the width of its column; Improve / Shorten and the note stay under the textarea.
  assert.match(card, /name="final_specification_override"[\s\S]*?rows=\{8\}[\s\S]*?className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs leading-5 text-zinc-700 outline-none focus:border-emerald-800"/);
  const control = card.indexOf("<FinalSpecificationAiControl"), note = card.indexOf("This only updates the current quotation item.");
  assert.ok(textarea < control && textarea < note, "the note and the Improve / Shorten control come after the textarea");
  assert.ok(card.indexOf('<div className="grid gap-4 lg:grid-cols-2">') < price, "two groups side by side from the wide breakpoint, one column below");
  // Two groups side by side on wide screens, one column below; every column may shrink so nothing scrolls sideways.
  assert.match(card, /<div className="grid gap-4 lg:grid-cols-2">/);
  assert.equal((card.match(/className="min-w-0 space-y-3"/g) ?? []).length, 2);
  assert.doesNotMatch(card, /overflow-x|w-\[\d+px\]|min-w-\[/, "no fixed widths that could force horizontal scroll");
});

test("the same handlers and calculations are still wired, exactly as often as before", () => {
  const before: Record<string, number> = {
    setExchangeRates: 2, setDiscountTypes: 2, setDiscountValues: 2, setFinalSpecifications: 4, setFinalSpecificationEditedByTemplate: 4, FinalSpecificationAiControl: 2,
    setConfiguredDimensions: 4, setConfiguredDimensionEditedByTemplate: 3, setDimensionBeforeEditing: 2, setQuotationBrands: 3, setQuotationOrigins: 3, setTemplatePriceOverrides: 3,
    setPendingPriceUpdateChoice: 4, sourceTotalsList: 2, originalCurrencyTotals: 14, nonAedCurrencies: 7, missingExchangeRate: 5, unitDiscountAmount: 3, netPricePreview: 4, netTotalPreview: 3,
    keepDimensionLine: 2, generatedFinalSpecification: 3,
  };
  for (const [name, count] of Object.entries(before)) assert.equal((source.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length, count, name);
  // Spot checks of the wiring inside the card.
  assert.match(card, /setExchangeRates\(\(current\) => \(\{/);
  assert.match(card, /value=\{templateExchangeRates\[currency\] \?\? ""\}/);
  assert.match(card, /setDiscountTypes\(\(current\) => \(\{/);
  assert.match(card, /setQuotationBrands\(/);
  assert.match(card, /setQuotationOrigins\(/);
  assert.match(card, /setConfiguredDimensionEditedByTemplate\(\(current\) => \(\{ \.\.\.current, \[template\.id\]: false \}\)/);
  // The hidden form fields stay with Materials & Finishes, after the right column.
  assert.ok(at('name="quotation_brand_override"') > materials);
  assert.ok(at('name="template_id"') > materials);
});
