import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_HISTORY_MESSAGES,
  CLIENT_HISTORY_PAGE_SIZE,
  clampHistoryPage,
  cleanHistoryQuery,
  clientHistoryMessage,
  historySearchPattern,
  isClientHistoryKind,
  isHistoryId,
  isSafeRowId,
  normaliseHistoryText,
  priceChange,
  readPriceHistory,
  specPreview,
} from "./client-history";

test("page size is 30 and pages start at 1", () => {
  assert.equal(CLIENT_HISTORY_PAGE_SIZE, 30);
  assert.equal(clampHistoryPage(undefined), 1);
  assert.equal(clampHistoryPage("abc"), 1);
  assert.equal(clampHistoryPage(0), 1);
  assert.equal(clampHistoryPage(-4), 1);
  assert.equal(clampHistoryPage(3.9), 3);
  assert.equal(clampHistoryPage("7"), 7);
  assert.equal(clampHistoryPage(10 ** 9), 10_000);
});

test("search normaliser: lower case, spaces, dashes, underscores and dots are ignored", () => {
  assert.equal(normaliseHistoryText("EV-211"), "ev211");
  assert.equal(normaliseHistoryText(" Ev 2.11 "), "ev211");
  assert.equal(normaliseHistoryText(42), "");
});

test("search text is cleaned: filter characters removed, whitespace collapsed, 80 characters at most", () => {
  assert.equal(cleanHistoryQuery("  desk,  (oak) \"x\" "), "desk oak x");
  assert.equal(cleanHistoryQuery(undefined), "");
  assert.equal(cleanHistoryQuery("a".repeat(200)).length, 80);
});

test("search pattern escapes % and _ so they only match themselves", () => {
  assert.equal(historySearchPattern("desk"), "%desk%");
  assert.equal(historySearchPattern("100%"), "%100\\\\%%");
  assert.equal(historySearchPattern("a_b"), "%a\\\\_b%");
  assert.equal(historySearchPattern("a\\b"), "%ab%", "a backslash typed by the user cannot become an escape");
  assert.equal(historySearchPattern("   "), null);
  assert.equal(historySearchPattern(null), null);
});

test("price change is computed only when the currencies match", () => {
  assert.deepEqual(priceChange({ price: 1000, currency: "AED" }, { price: 1100, currency: "aed" }), { difference: 100, percent: 10, direction: "up" });
  assert.deepEqual(priceChange({ price: 1000, currency: "AED" }, { price: 900, currency: "AED" }), { difference: -100, percent: -10, direction: "down" });
  assert.deepEqual(priceChange({ price: "1000", currency: "AED" }, { price: 1000, currency: "AED" }), { difference: 0, percent: 0, direction: "same" });
  assert.equal(priceChange({ price: 1000, currency: "AED" }, { price: 300, currency: "USD" }), null, "different currency: no comparison");
  assert.equal(priceChange({ price: 1000, currency: "" }, { price: 1, currency: "" }), null);
  assert.equal(priceChange({ price: "x", currency: "AED" }, { price: 1, currency: "AED" }), null);
  assert.equal(priceChange({ price: 0, currency: "AED" }, { price: 50, currency: "AED" })?.percent, null, "no percent from a zero price");
  assert.equal(priceChange({ price: 3, currency: "AED" }, { price: 4, currency: "AED" })?.percent, 33.33);
});

test("message map: one place, friendly text, no paths or ids", () => {
  for (const [kind, text] of Object.entries(CLIENT_HISTORY_MESSAGES)) {
    assert.ok(text.length > 10, kind);
    assert.doesNotMatch(text, /quote-images|supabase|uuid|[0-9a-f]{8}-[0-9a-f]{4}/i, kind);
  }
  assert.equal(clientHistoryMessage("picture_gone"), "The old picture is no longer available, so the row was added without it.");
});

test("id and kind validation", () => {
  assert.equal(isHistoryId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isHistoryId("nope"), false);
  assert.equal(isHistoryId(null), false);
  assert.equal(isSafeRowId("item-abc_123"), true);
  assert.equal(isSafeRowId("../x"), false);
  assert.equal(isSafeRowId(""), false);
  assert.equal(isClientHistoryKind("custom"), true);
  assert.equal(isClientHistoryKind("other"), false);
});

test("spec preview is short and cut at a word end", () => {
  assert.equal(specPreview("Solid oak\n  top"), "Solid oak top");
  const long = `${"word ".repeat(60)}end`;
  const preview = specPreview(long);
  assert.ok(preview.length <= 162 && preview.endsWith("…"));
  assert.equal(specPreview(null), "");
});

test("price history keeps at most 5 readable entries", () => {
  const entries = readPriceHistory([
    { price: 10, currency: "AED", qty: 2, at: "2026-11-01T00:00:00Z", quotation_no: "QN-1", quotation_id: "hidden" },
    { price: "bad", currency: "AED" },
    "junk",
    { price: 9, currency: "AED" },
    ...Array.from({ length: 10 }, (_, index) => ({ price: index, currency: "AED" })),
  ]);
  assert.equal(entries.length <= 5, true);
  assert.deepEqual(entries[0], { price: 10, currency: "AED", qty: 2, at: "2026-11-01T00:00:00Z", quotationNo: "QN-1" });
  assert.ok(!("quotation_id" in entries[0]) && !("quotationId" in entries[0]), "internal ids are not passed on");
  assert.deepEqual(readPriceHistory("x"), []);
});
