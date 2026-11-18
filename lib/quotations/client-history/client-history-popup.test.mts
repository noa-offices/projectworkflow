import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lastQuotedLine, previousPriceChangeText, priceHistoryLine, shortClientName } from "./client-history-view";

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
  assert.match(selector, /onOpenSetup=\{openSetupFromCollection\}/);
  assert.match(selector, /onOpenProduct=\{openProductFromHistory\}/);
  assert.match(server, /clientHistory=\{\{ clientId: quotation\.client_id, clientName \}\}/);
  assert.match(server, /clientName=\{client\?\.company_name \?\? ""\}/);
  assert.equal((local.match(/clientHistory=\{\{ clientId: workspace\.client_id \?\? null/g) ?? []).length, 2, "both local selectors");
});

test("kind routing: custom -> add action, configured -> openSetupFromCollection replay, library -> open product", () => {
  assert.match(button, /item\.kind === "custom" && target\?\.kind === "server"[\s\S]*addHistoryItemToQuotationAction\(\{ quotationId: target\.quotationId, sectionId: target\.sectionId, historyId: item\.id \}\)/);
  assert.match(button, /data\.kind === "configured"[\s\S]*onOpenSetup\(data\.setup\)/);
  assert.match(button, /data\.kind === "library"[\s\S]*onOpenProduct\(data\.templateId\)/);
  assert.match(button, /target\?\.kind === "local" && target\.onAddHistory[\s\S]*target\.onAddHistory\(data\)/);
  // The server builder does not send the browser's client to the add action: only the quotation id.
  assert.doesNotMatch(button, /addHistoryItemToQuotationAction\(\{[^}]*clientId/);
  // The library item opens the product without a replay and without adding or pricing anything.
  assert.match(selector, /const openProductFromHistory = \(templateId: string\): string \| null => \{[\s\S]*?setReplay\(null\);[\s\S]*?setSelectedTemplateId\(templateId\);[\s\S]*?setIsOpen\(true\);/);
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
    "lib/quotations/client-history/client-history-popup.test.mts",
    "lib/products/saved-setups/custom-item-line.test.mts",
    "lib/products/saved-setups/replay.test.mts",
  ];
  const outside = changed.filter((file) => !allowed.includes(file));
  assert.deepEqual(outside, [], `unexpected files: ${outside.join(", ")}`);
  assert.ok(changed.length <= 12);
});
