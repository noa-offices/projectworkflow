import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { historyCustomLine, readLineDiscount, readPriceHistory } from "./client-history";
import { rowOverlayFromCustomItem } from "../../products/saved-setups/custom-item-line";
import { LEGACY_PRICING_RULE, quotationLinePricing } from "../../quotation-pricing";
import { carriedDiscount, historyDiscountNote, lastQuotedLine, lastQuotedMeta, lastQuotedPrice, previousPriceChangeText, priceHistoryLine, shortClientName } from "./client-history-view";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const button = read("../../../components/quotations/add-from-client-history-button.tsx");
const selector = read("../../../components/quotations/product-library-selector.tsx");
const pane = read("../../../components/quotations/custom-item-picker-pane.tsx");
const local = read("../../../components/quotations/local-quotation-builder.tsx");
const server = read("../../../app/quotations/[id]/builder/page.tsx");

const base = { currency: "AED", lastUnitPrice: 1250, lastQuotedAt: "2026-10-12T08:00:00Z", lastQuotationNo: "QF-0107-001" };

test("last quoted line: money formatter, Dubai date, quote number", () => {
  assert.equal(lastQuotedLine(base), "Last quoted AED 1,250.00 · 12 Oct 2026 · QF-0107-001");
  assert.equal(lastQuotedLine({ ...base, lastQuotationNo: null }), "Last quoted AED 1,250.00 · 12 Oct 2026");
  // 23:30 UTC on 12 Oct is already 13 Oct in Dubai.
  assert.match(lastQuotedLine({ ...base, lastQuotedAt: "2026-10-12T23:30:00Z" }), /13 Oct 2026/);
});

test("price change: shown for the same currency, never across currencies", () => {
  const history = (price: number, currency: string) => ({ price, currency, qty: 1, at: "2026-09-01T00:00:00Z", quotationNo: "QF-1" });
  const up = previousPriceChangeText({ currency: "AED", lastUnitPrice: 1250, priceHistory: [history(1250, "AED"), history(1200, "AED")] });
  assert.equal(up, "▲ 50.00 (4.2%) vs previous");
  const down = previousPriceChangeText({ currency: "AED", lastUnitPrice: 1150, priceHistory: [history(1150, "AED"), history(1200, "AED")] });
  assert.equal(down, "▼ 50.00 (4.2%) vs previous");
  assert.equal(previousPriceChangeText({ currency: "AED", lastUnitPrice: 1200, priceHistory: [history(1200, "AED"), history(1200, "AED")] }), "Unchanged vs previous");
  assert.equal(previousPriceChangeText({ currency: "AED", lastUnitPrice: 1250, priceHistory: [history(1250, "AED"), history(300, "USD")] }), null, "different currency: never compared");
  assert.equal(previousPriceChangeText({ currency: "AED", lastUnitPrice: 1250, priceHistory: [history(1250, "AED")] }), null, "no older price");
  assert.equal(previousPriceChangeText({ currency: "AED", lastUnitPrice: 1250, priceHistory: [] }), null);
  // The nearest older price in the SAME currency is used, skipping a foreign one in between.
  assert.equal(previousPriceChangeText({ currency: "AED", lastUnitPrice: 1250, priceHistory: [history(1250, "AED"), history(300, "USD"), history(1000, "AED")] }), "▲ 250.00 (25.0%) vs previous");
});

test("price history line and short client name", () => {
  assert.equal(priceHistoryLine({ price: 1250, currency: "AED", qty: 4, at: "2026-10-12T08:00:00Z", quotationNo: "QF-1" }), "AED 1,250.00 · qty 4 · 12 Oct 2026 · QF-1");
  assert.equal(shortClientName("  Acme   Trading LLC "), "Acme Trading LLC");
  assert.ok(shortClientName("A very long client company name that keeps going").length <= 24);
});

test("the button is rendered next to My Collection inside the Product Library selector, in both builders", () => {
  assert.match(selector, /<AddFromMyCollectionButton onChoose=\{openSetupFromCollection\} \/>\s*\{clientHistory \? \(\s*<AddFromClientHistoryButton/);
  assert.match(selector, /onOpenSetup=\{openSetupFromHistory\}/);
  assert.match(selector, /onOpenProduct=\{openProductFromHistory\}/);
  assert.match(server, /clientHistory=\{\{ clientId: quotation\.client_id, clientName, quoteCurrency: quotation\.currency \}\}/);
  assert.match(server, /clientName=\{client\?\.company_name \?\? ""\}/);
  assert.equal((local.match(/clientHistory=\{\{ clientId: workspace\.client_id \?\? null/g) ?? []).length, 2, "both local selectors");
});

test("kind routing: custom -> add action, configured -> openSetupFromCollection replay, library -> open product", () => {
  assert.match(button, /item\.kind === "custom" && target\?\.kind === "server"[\s\S]*addHistoryItemToQuotationAction\(\{ quotationId: target\.quotationId, sectionId: target\.sectionId, historyId: item\.id \}\)/);
  assert.match(button, /data\.kind === "configured"[\s\S]*onOpenSetup\(data\.setup, carriedDiscount\(data, quoteCurrency\)\)/);
  assert.match(button, /data\.kind === "library"[\s\S]*onOpenProduct\(data\.templateId, carriedDiscount\(data, quoteCurrency\)\)/);
  assert.match(button, /target\?\.kind === "local" && target\.onAddHistory[\s\S]*target\.onAddHistory\(data\)/);
  // The server builder does not send the browser's client to the add action: only the quotation id.
  assert.doesNotMatch(button, /addHistoryItemToQuotationAction\(\{[^}]*clientId/);
  // The library item opens the product without a replay and without adding or pricing anything.
  assert.match(selector, /const openProductFromHistory = \(templateId: string, historyDiscount: HistoryDiscount \| null\): string \| null => \{[\s\S]*?setReplay\(null\);[\s\S]*?setSelectedTemplateId\(templateId\);[\s\S]*?setIsOpen\(true\);/);
  assert.match(selector, /!templateById\.get\(templateId\)\) return "This product is not available/);
});

test("local builder: custom history row uses the same overlay and currency rule; a picture failure never blocks", () => {
  const start = local.indexOf("function addHistoryCustomRow");
  const body = local.slice(start, local.indexOf("function addProductItem", start));
  assert.match(body, /rowOverlayFromCustomItem\(/);
  assert.match(body, /overlayFields\(overlay\)/);
  assert.match(body, /commit\(\(current\) => \(\{[\s\S]*createEmptyItem\(current, "custom", sectionId\)/);
  // The row is committed BEFORE the picture is requested, and a failed copy only sets a message.
  assert.ok(body.indexOf("commit((current)") < body.indexOf("copyHistoryPictureToLocalRowAction("));
  assert.match(body, /if \(!copied\.ok\) return pictureFailed\(copied\.message\)/);
  assert.match(body, /\.catch\(\(\) => pictureFailed\(\)\)/);
  assert.match(local, /onAddHistory: \(data\) => addHistoryCustomRow\(section\.id, data\)/);
  assert.match(pane, /onAddHistory\?: \(item: Extract<ClientHistoryAddItem, \{ kind: "custom" \}>\) => string \| null/);
});

test("the redundant inner CustomItemTargetProvider is gone: one provider per section, and the outer one is unchanged", () => {
  assert.equal((local.match(/<CustomItemTargetProvider /g) ?? []).length, 1);
  assert.equal((local.match(/<\/CustomItemTargetProvider>/g) ?? []).length, 1);
  assert.match(local, /<CustomItemTargetProvider value=\{\{ kind: "local", onAdd: \(item\) => addCustomItemRow\(section\.id, item\), onAddHistory/);
});

test("delete asks first, then calls the delete action and removes the card", () => {
  assert.match(button, /Remove this item from \{clientName\}&apos;s history\? Quotes are not affected\./);
  assert.match(button, /onClick=\{\(\) => onAskRemove\(item\.id\)\}/, "the trash icon only asks");
  assert.match(button, /onClick=\{\(\) => onRemove\(item\.id\)\}/, "only the confirm button deletes");
  assert.match(button, /deleteClientHistoryAction\(\{ historyId: id \}\)[\s\S]*setItems\(\(current\) => current\?\.filter\(\(entry\) => entry\.id !== id\)/);
});

test("states: loading skeleton, empty, failure with Retry, no client selected", () => {
  assert.match(button, /aria-label="Loading"/);
  assert.match(button, /Nothing quoted for this client yet\. Items appear here after a quotation is sent or confirmed\./);
  assert.match(button, /setError\(result\.message\)/);
  assert.match(button, />Retry</);
  assert.match(button, /disabled=\{!hasClient\}/);
  assert.match(button, /"Select a client first"/);
  assert.match(button, /Load more/);
  assert.doesNotMatch(button, /IntersectionObserver/, "no infinite scroll");
});

test("popup: Escape closes (confirmation first), search is debounced, kind chips, price history is quiet", () => {
  assert.match(button, /event\.key !== "Escape"[\s\S]*if \(confirmId\) setConfirmId\(null\);[\s\S]*else setOpen\(false\)/);
  assert.match(button, /SEARCH_DEBOUNCE_MS/);
  assert.match(button, /CLIENT_HISTORY_KIND_FILTERS\.map/);
  assert.match(button, /aria-expanded=\{expanded\}/);
  assert.match(button, /role="dialog" aria-modal="true"/);
  assert.match(button, /sm:inline">Add from \{label\} history[\s\S]*sm:hidden">Client history/);
});

test("no admin client, and nothing sensitive is logged or shown", () => {
  for (const [name, text] of [["button", button], ["view", read("./client-history-view.ts")]] as const) {
    assert.doesNotMatch(text, /createAdminClient|service_role|SUPABASE_SERVICE/, name);
    assert.doesNotMatch(text, /console\.(log|error|warn|info|debug)/, `${name}: nothing logged`);
  }
  assert.doesNotMatch(button, /\.recipe|line_recipe|pictureRef/, "the list never exposes the recipe or a raw picture reference");
});

test("diff guard: only the popup files change; no SQL, no pricing, no H-B server files, no package change", () => {
  let base: string;
  try {
    base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  } catch {
    return; // no origin/main in this checkout
  }
  const changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" }).split("\n").map((line) => line.trim()).filter((line) => line && line !== "AGENTS.md");
  const allowed = [
    "components/quotations/add-from-client-history-button.tsx",
    "components/quotations/product-library-selector.tsx",
    "components/quotations/custom-item-picker-pane.tsx",
    "components/quotations/local-quotation-builder.tsx",
    "app/quotations/[id]/builder/page.tsx",
    "lib/quotations/client-history/client-history-view.ts",
    "lib/quotations/client-history/client-history.ts",
    "lib/quotations/client-history/client-history-service.ts",
    "lib/quotations/client-history/client-history-service.test.mts",
    "lib/quotations/client-history/client-history-wiring.test.mts",
    "app/quotations/actions.ts",
    "supabase/migrations/20261119150000_client_history_list_price_discount.sql",
    "lib/quotations/client-history/client-history-popup.test.mts",
    "lib/products/saved-setups/custom-item-line.test.mts",
    "lib/products/saved-setups/replay.test.mts",
  ];
  const outside = changed.filter((file) => !allowed.includes(file));
  assert.deepEqual(outside, [], `unexpected files: ${outside.join(", ")}`);
  assert.ok(changed.length <= 12);
});

// ── H-D: list price + discount ─────────────────────────────────────────────
const discounted = { currency: "AED", lastUnitPrice: 2114, listUnitPrice: 2487, discountType: "percent" as const, discountValue: 15, qty: 3, lastQuotedAt: "2026-10-12T08:00:00Z", lastQuotationNo: "QF-0107-001" };

test("card text: percent, amount, no discount and an old row", () => {
  assert.equal(lastQuotedPrice(discounted), "Last quoted List AED 2,487.00 · −15% · Net AED 2,114.00");
  assert.equal(lastQuotedMeta(discounted), "Qty 3 · 12 Oct 2026 · QF-0107-001");
  assert.equal(lastQuotedPrice({ ...discounted, discountType: "amount", discountValue: 100, listUnitPrice: 2214, lastUnitPrice: 2114 }), "Last quoted List AED 2,214.00 · −AED 100.00 · Net AED 2,114.00");
  assert.equal(lastQuotedLine({ currency: "AED", lastUnitPrice: 1250, listUnitPrice: 1250, discountType: null, discountValue: null, qty: 3, lastQuotedAt: discounted.lastQuotedAt, lastQuotationNo: "QF-0107-001" }), "Last quoted AED 1,250.00 · Qty 3 · 12 Oct 2026 · QF-0107-001");
  // an old row: no list / discount at all, exactly the plain price
  assert.equal(lastQuotedPrice({ currency: "AED", lastUnitPrice: 1250, listUnitPrice: null, discountType: null, discountValue: null, lastQuotedAt: "", lastQuotationNo: null }), "Last quoted AED 1,250.00");
  assert.equal(lastQuotedPrice({ currency: "AED", lastUnitPrice: 1250, lastQuotedAt: "", lastQuotationNo: null }), "Last quoted AED 1,250.00");
  assert.equal(lastQuotedPrice({ ...discounted, discountValue: 12.5, lastUnitPrice: 2176 }), "Last quoted List AED 2,487.00 · −12.5% · Net AED 2,176.00");
});

test("price history shows list, discount and net for entries that have them; the comparison uses NET prices, same currency only", () => {
  const [withDiscount, plain] = readPriceHistory([
    { price: 2114, currency: "AED", qty: 3, at: "2026-10-12T08:00:00Z", quotation_no: "QF-2", list_price: 2487, discount_type: "percent", discount_value: 15 },
    { price: 1900, currency: "AED", qty: 1, at: "2026-08-20T08:00:00Z", quotation_no: "QF-1" },
  ]);
  assert.equal(priceHistoryLine(withDiscount), "List AED 2,487.00 · −15% · Net AED 2,114.00 · qty 3 · 12 Oct 2026 · QF-2");
  assert.equal(priceHistoryLine(plain), "AED 1,900.00 · qty 1 · 20 Aug 2026 · QF-1");
  const item = { ...discounted, priceHistory: [withDiscount, plain] };
  assert.equal(previousPriceChangeText(item), "▲ 214.00 (11.3%) vs previous", "net 2114 against net 1900, not against the list price");
  assert.equal(previousPriceChangeText({ ...item, priceHistory: [withDiscount, { ...plain, currency: "USD" }] }), null, "never across currencies");
});

test("the three columns are read as a set: a discount needs its value and a list price", () => {
  assert.deepEqual(readLineDiscount("2487", "percent", "15"), { listUnitPrice: 2487, discountType: "percent", discountValue: 15 });
  assert.deepEqual(readLineDiscount(2487, null, null), { listUnitPrice: 2487, discountType: null, discountValue: null });
  assert.deepEqual(readLineDiscount(null, null, null), { listUnitPrice: null, discountType: null, discountValue: null });
  assert.deepEqual(readLineDiscount(null, "percent", 15), { listUnitPrice: null, discountType: null, discountValue: null }, "no list price: no discount");
  assert.deepEqual(readLineDiscount(100, "percent", 150), { listUnitPrice: 100, discountType: null, discountValue: null });
  assert.deepEqual(readLineDiscount(100, "weird", 5), { listUnitPrice: 100, discountType: null, discountValue: null });
});

function customRow(input: Parameters<typeof historyCustomLine>[0], quoteCurrency: string, rule: Parameters<typeof quotationLinePricing>[0]) {
  // exactly what the two builders do: overlay, then the existing pricing helper
  const line = historyCustomLine(input, quoteCurrency);
  const overlay = rowOverlayFromCustomItem({ brandName: "Acme", itemName: "Table", itemCode: null, specification: null, unitLabel: "Pc", sellingPrice: line.sellingPrice, currency: input.currency }, quoteCurrency);
  return { line, overlay, pricing: quotationLinePricing(rule, overlay.unit_price, line.discountType, line.discountValue, line.qty) };
}

test("custom add: the same numbers as a manually typed line (list 2487, 15% off, qty 3)", () => {
  const input = { price: 2114, currency: "AED", listUnitPrice: 2487, discountType: "percent" as const, discountValue: 15, qty: 3 };
  for (const rule of [LEGACY_PRICING_RULE, "whole_aed_v1" as const]) {
    const row = customRow(input, "AED", rule);
    assert.deepEqual(row.pricing, quotationLinePricing(rule, 2487, "percent", 15, 3), "identical to typing the list price and the discount");
    assert.equal(row.line.qty, 3);
    assert.equal(row.pricing.discountValue, 15);
  }
  const whole = customRow(input, "AED", "whole_aed_v1").pricing;
  assert.deepEqual([whole.unitPrice, whole.netPrice, whole.netTotal], [2487, 2114, 6342]);
});

test("custom add: amount discount, no discount, old row and missing qty", () => {
  const amount = customRow({ price: 2114, currency: "AED", listUnitPrice: 2214, discountType: "amount", discountValue: 100, qty: 2 }, "AED", "whole_aed_v1");
  assert.deepEqual([amount.line.discountType, amount.pricing.unitPrice, amount.pricing.netPrice, amount.pricing.netTotal], ["amount", 2214, 2114, 4228]);
  const none = customRow({ price: 1250, currency: "AED", listUnitPrice: 1250, discountType: null, discountValue: null, qty: 3 }, "AED", "whole_aed_v1");
  assert.deepEqual([none.line.discountValue, none.pricing.netPrice, none.pricing.netTotal], [0, 1250, 3750]);
  // an old row (nothing stored): a plain price line at the last price
  const old = customRow({ price: 1250, currency: "AED", listUnitPrice: null, discountType: null, discountValue: null, qty: null }, "AED", "whole_aed_v1");
  assert.deepEqual([old.overlay.unit_price, old.line.discountValue, old.line.qty, old.pricing.netPrice], [1250, 0, 1, 1250]);
  assert.equal(historyCustomLine({ price: 1, currency: "AED", listUnitPrice: null, discountType: null, discountValue: null, qty: 0 }, "AED").qty, 1, "a zero quantity becomes 1");
});

test("custom add: a different currency gives price 0, the existing manual source keys and NO discount", () => {
  const row = customRow({ price: 2114, currency: "USD", listUnitPrice: 2487, discountType: "percent", discountValue: 15, qty: 3 }, "AED", "whole_aed_v1");
  assert.equal(row.overlay.unit_price, 0);
  assert.deepEqual(row.overlay.source_component_data, { manual_source_price: 2114, manual_source_currency: "USD" }, "the NET price that was charged is kept for the user to convert");
  assert.deepEqual([row.line.discountType, row.line.discountValue, row.pricing.netPrice, row.pricing.netTotal], ["amount", 0, 0, 0]);
  assert.match(row.overlay.conversionNote ?? "", /Convert it to AED/);
});

test("configured / library: a percent is carried, an amount only in the quote's own currency; the note is one short line", () => {
  assert.deepEqual(carriedDiscount({ currency: "AED", discountType: "percent", discountValue: 15 }, "USD"), { discountType: "percent", discountValue: 15, currency: "AED" });
  assert.equal(carriedDiscount({ currency: "AED", discountType: "amount", discountValue: 100 }, "AED")?.discountType, "amount");
  assert.equal(carriedDiscount({ currency: "AED", discountType: "amount", discountValue: 100 }, "USD"), null, "an amount in another currency would be a wrong number");
  assert.equal(carriedDiscount({ currency: "AED", discountType: "amount", discountValue: 100 }, null), null);
  assert.equal(carriedDiscount({ currency: "AED", discountType: null, discountValue: null }, "AED"), null);
  assert.equal(historyDiscountNote({ discountType: "percent", discountValue: 15, currency: "AED" }), "Client history: 15% discount will be applied");
  assert.equal(historyDiscountNote({ discountType: "amount", discountValue: 100, currency: "AED" }), "Client history: AED 100.00 discount will be applied");
});

test("wiring: the discount goes through the configurator's own discount state; both builders price the custom row with the existing helper", () => {
  assert.match(selector, /const openSetupFromHistory = \(setup: SetupForUse, historyDiscount: HistoryDiscount \| null\): string \| null => \{\s*const problem = openSetupFromCollection\(setup\);\s*if \(!problem\) applyHistoryDiscount\(setup\.templateId, historyDiscount\);/);
  assert.match(selector, /setDiscountTypes\(\(current\) => \(\{ \.\.\.current, \[tid\]: historyDiscount \? historyDiscount\.discountType : "none" \}\)\)/);
  assert.match(selector, /setDiscountValues\(\(current\) => \(\{ \.\.\.current, \[tid\]: historyDiscount \? String\(historyDiscount\.discountValue\) : "" \}\)\)/);
  assert.match(selector, /historyNote\.text/);
  assert.match(local, /historyCustomLine\(data, workspace\.currency\)/);
  assert.match(local, /quotationLinePricing\(readPricingRule\(workspace\.layout_settings\), overlay\.unit_price, line\.discountType, line\.discountValue, line\.qty\)/);
  assert.match(local, /discount_type: hasDiscount \? line\.discountType : "none"/);
  assert.match(local, /qty: line\.qty,\s*unit_price: pricing\.unitPrice/);
  assert.match(local, /quoteCurrency: workspace\.currency/);
  assert.match(server, /quoteCurrency: quotation\.currency/);
  // the configurator's own pricing is untouched: the discount only fills the state it already reads
  assert.equal((selector.match(/quotationLinePricing\(/g) ?? []).length, 1);
});

test("H-D: the attached migration is present; nothing is logged and no admin client is used", () => {
  const sql = read("../../../supabase/migrations/20261119150000_client_history_list_price_discount.sql");
  assert.match(sql, /add column if not exists list_unit_price numeric\(14,2\)/);
  const view = read("./client-history-view.ts");
  assert.doesNotMatch(view + button, /console\./);
  assert.doesNotMatch(view + button, /createAdminClient|service_role/);
});
