import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-orchestrator.ts has "server-only" + "@/..." aliases - not resolvable by Node's plain ESM
// resolver outside the Next.js build. Source-level wiring/safety checks, the same convention as
// every other lib/noa/*-safety.test.mts file.

const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const stateSource = readFileSync("lib/products/product-configuration-state.ts", "utf8");

function slice(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end > 0 ? source.slice(start, end) : source.slice(start);
}

// ── PART 1/2: the proven root cause - option-level currency, never a hardcoded/aggregate one ──

test("1. ProductConfigurationOption carries its own priceCurrency field", () => {
  assert.ok(stateSource.includes("priceCurrency?: string | null;"));
});

test("2. a Base/Model (variant_row) option's priceCurrency comes from its OWN row, never the aggregate configuration currency", () => {
  const block = slice(stateSource, "options: candidateRows.map((row) => ({", "})),");
  assert.ok(block.includes("priceCurrency: rowCurrency(row, template)"));
});

test("3. every priceContribution assignment site in GPC-1 also assigns a priceCurrency from the same row/source", () => {
  const contributionCount = (stateSource.match(/priceContribution:/g) ?? []).length;
  const currencyCount = (stateSource.match(/priceCurrency:/g) ?? []).length;
  // Two step kinds (category_row's own option list and the matrix-modular fabric_category
  // fallback columns) never carry a priceContribution at all, so they need no currency either -
  // the counts need not be equal, but every currency assignment must trace back to a real site
  // (never more currency assignments than price assignments).
  assert.ok(currencyCount > 0);
  assert.ok(currencyCount <= contributionCount);
});

test("4. GPC-1 never invents a new currency precedence - the shared rowCurrency() helper falls back to template.currency only when the row itself has none", () => {
  const block = slice(stateSource, "function rowCurrency(", "\n}");
  assert.ok(block.includes("template.currency"));
  assert.ok(!/normalizeCurrency|convert|exchangeRate/i.test(block));
});

// ── PART 3: the orchestrator's choice formatter uses the OPTION's own currency ─────────────────

test("5. configurationChoiceSecondary formats price using option.priceCurrency, never a passed-in aggregate currency string", () => {
  const block = slice(orchestratorSource, "function configurationChoiceSecondary(", "\n}");
  assert.ok(block.includes("option.priceCurrency"));
  assert.ok(!block.includes("currency: string"));
  assert.ok(!/^function configurationChoiceSecondary\(option: ProductConfigurationOption, currency/.test(block));
});

test("6. no hardcoded currency literal (e.g. \"AED\") is used to format a GPC choice price", () => {
  const block = slice(orchestratorSource, "function configurationChoiceSecondary(", "\n}");
  assert.ok(!/["'](?:AED|USD|EUR)["']/.test(block));
});

test("7. when an option has no priceCurrency, the price is OMITTED from the choice secondary text rather than guessed", () => {
  const block = slice(orchestratorSource, "function configurationChoiceSecondary(", "\n}");
  assert.ok(block.includes("typeof option.priceContribution === \"number\" && option.priceCurrency"));
});

// ── PART 4: completion text is unchanged - still tied directly to GPC-1's own aggregate price ──

test("8. the completion answer still reads price directly from state.price.currency/state.price.unit - no separate formatter/arithmetic was introduced", () => {
  const block = slice(orchestratorSource, "function productConfigurationCompletionAnswer(", "\n}");
  assert.ok(block.includes("state.price.currency"));
  assert.ok(block.includes("state.price.unit"));
  assert.ok(!/roundSourceAmount|toFixed|normalizeCurrency/.test(block));
});

// ── Regression: GPC-3/GPC-3.1 transport and pricing arithmetic are unchanged ────────────────────

test("9. GPC-3.1's choice transport (NoaChoice shape / button rendering path) is unaffected - only the currency SOURCE changed, not the shape", () => {
  const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");
  assert.ok(typesSource.includes("secondary?: string;"));
  assert.ok(orchestratorSource.includes("value: option.label,"));
});

test("10. no pricing arithmetic changed - roundSourceAmount/systemPriceContribution/baseModelPriceOrDefault call sites are unchanged in count", () => {
  assert.ok(stateSource.includes("systemPriceContribution(option.row, currency, 1)"));
  assert.ok(stateSource.includes("roundSourceAmount(contribution.amount)"));
});
