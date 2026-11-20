import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { galleryAedView } from "./gallery-aed";
import { configureReasonText, fetchGalleryPriceBatches, galleryPriceLayout, galleryPriceView, type GalleryPriceEntry } from "./gallery-price-view";

const template = "11111111-1111-4111-8111-111111111111";
const priced = (key: "current" | "needs_check" | "no_price_list" = "current"): Extract<GalleryPriceEntry, { status: "priced" }> => ({
  status: "priced",
  sourceTotals: [{ currency: "EUR", amount: 882 }],
  priceCheck: {
    checkedAt: "2026-11-03", checkedBy: "internal-id", checkedByName: "Sara Khan", intervalDays: 90, note: null,
    state: { key, label: "", helper: "", tone: "ok" },
  },
});

test("formats the current source price, keeps split currencies and maps the returned status", () => {
  assert.deepEqual(galleryPriceView(template, priced()), {
    kind: "priced", amount: "EUR 882.00", badge: { label: "Price checked", tone: "ok" },
    checked: "Checked on 3 Nov 2026 by Sara Khan",
  });
  assert.deepEqual(galleryPriceView(template, { ...priced("needs_check"), sourceTotals: [{ currency: "EUR", amount: 5 }, { currency: "USD", amount: 7.5 }] }), {
    kind: "priced", amount: "EUR 5.00 + USD 7.50", badge: { label: "Price update available", tone: "warning" },
    checked: "Checked on 3 Nov 2026 by Sara Khan",
  });
  assert.equal(galleryPriceView(template, priced("no_price_list"))?.kind, "priced");
  const unknown = galleryPriceView(template, priced("no_price_list"));
  assert.equal(unknown?.kind === "priced" ? unknown.badge : undefined, null);
});

test("links unpriceable products to Product Management and separates loading from absent data", () => {
  assert.deepEqual(galleryPriceView(template, { status: "needs_configure" }), { kind: "configure", href: `/products/manage?template=${template}`, reason: "Price cannot be calculated here" });
  assert.deepEqual(galleryPriceView(template, "loading"), { kind: "loading" });
  assert.equal(galleryPriceView(template, undefined), null);
});

test("one action per normal page, splits over 60 and omits empty or failed responses", async () => {
  const calls: string[][] = [];
  const ids = Array.from({ length: 125 }, (_, i) => String(i));
  const fetch = async (ids: string[]) => { calls.push(ids); return { ok: true as const, prices: {} }; };
  assert.deepEqual(await fetchGalleryPriceBatches(ids.slice(0, 30), fetch), {});
  assert.deepEqual(calls.map((ids) => ids.length), [30]);
  calls.length = 0;
  assert.deepEqual(await fetchGalleryPriceBatches(ids, fetch), {});
  assert.deepEqual(calls.map((ids) => ids.length), [60, 60, 5]);
  assert.deepEqual(await fetchGalleryPriceBatches(["a"], async () => { throw new Error("offline"); }), {});
  assert.deepEqual(await fetchGalleryPriceBatches(["a"], async () => ({ ok: false, message: "unavailable" })), {});
});

test("only the list loader requests amounts, and the popup reuses its result", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const page = read("../../../app/products/gallery/page.tsx");
  const browser = read("../../../components/products/product-gallery-browser.tsx");
  const popup = read("../../../components/products/product-gallery-detail-dialog.tsx");
  const block = read("../../../components/products/product-gallery-price.tsx");
  const pricing = read("./gallery-price-service.ts");
  const card = browser.slice(browser.indexOf("function GalleryCard"), browser.indexOf("function Skeleton"));
  assert.match(page, /canSeePrices=\{canManageProductLibrary\(profile\?\.role\)\}/);
  assert.match(browser, /if \(!canSeePrices \|\| !items\.length\) return/);
  assert.equal((browser.match(/fetchGalleryPriceBatches\(ids, getGalleryPricesAction\)/g) ?? []).length, 1);
  assert.match(browser, /void loadPrices\(result\.items, id\)/);
  assert.match(browser, /void loadPrices\(result\.items\.filter\(/);
  assert.match(browser, /request !== requestId\.current/);
  assert.match(browser, /window\.addEventListener\("pw-read-refresh", onRefresh\)/);
  assert.match(browser, /if \(result\.ok\) await afterChange\(result\.message\)/);
  assert.match(browser, /await Promise\.all\(\[reload\(state\), loadFilters\(\)\]\)/);
  assert.match(browser, /price=\{canSeePrices \? prices\[dialog\.item\.id\] : undefined\}/);
  assert.match(popup, /getGalleryItemDetailAction\(\{ id: itemId \}\)/);
  assert.match(block, /detail && view\.checked/);
  assert.doesNotMatch(card + popup, /getGalleryPricesAction|fetchGalleryPriceBatches/);
  for (const source of [page, browser, popup, block, pricing]) {
    assert.doesNotMatch(source, /createAdminClient|supabase\/admin|service_role|SUPABASE_SERVICE/i);
  }
});

test("maps needs_configure reason codes to plain language", () => {
  const text = (reason?: string) => configureReasonText(reason);
  assert.equal(text("unresolved_choices"), "Some saved choices changed in the product");
  assert.equal(text("invalid_recipe"), "Some saved choices changed in the product");
  assert.equal(text("retired_template"), "This product is no longer active");
  assert.equal(text("ambiguous_precedence"), "Modular and workstation pricing both apply");
  assert.equal(text("unresolved_linked_product"), "A linked product could not be resolved");
  for (const other of ["mixed_base_currencies", "constructor", "", undefined]) assert.equal(text(other), "Price cannot be calculated here");
  const view = galleryPriceView(template, { status: "needs_configure", reason: "retired_template" });
  assert.equal(view?.kind === "configure" ? view.reason : "", "This product is no longer active");
});

test("price box layout variants", () => {
  const eur = [{ currency: "EUR", amount: 435 }];
  const price = (sourceTotals: typeof eur): GalleryPriceEntry => ({ ...priced(), sourceTotals });
  const aed = (totals: typeof eur, defaults: Record<string, number>) => galleryAedView(price(totals), defaults, {});
  assert.deepEqual(galleryPriceLayout(eur, aed(eur, { EUR: 4.5 })), {
    headline: "≈ AED 1,958", lines: ["EUR 435.00"], notes: ["1 EUR = 4.5 AED (default)"], muted: [],
  });
  assert.deepEqual(galleryPriceLayout(eur, aed(eur, {})), { headline: "EUR 435.00", lines: [], notes: [], muted: ["No rate set"] });
  assert.deepEqual(galleryPriceLayout(eur, null), { headline: "EUR 435.00", lines: [], notes: [], muted: [] });
  const many = [...eur, { currency: "USD", amount: 100 }];
  const both = galleryPriceLayout(many, aed(many, { EUR: 4.5, USD: 3.67 }));
  assert.equal(both.headline, "≈ AED 2,325");
  assert.deepEqual(both.lines, ["EUR 435.00", "USD 100.00"]);
  const partial = galleryPriceLayout(many, aed(many, { EUR: 4.5 }));
  assert.equal(partial.headline, null);
  assert.deepEqual(partial.muted, ["No rate for USD"]);
});

test("loading keeps the box height and no access renders nothing", () => {
  const block = readFileSync(new URL("../../../components/products/product-gallery-price.tsx", import.meta.url), "utf8");
  const browser = readFileSync(new URL("../../../components/products/product-gallery-browser.tsx", import.meta.url), "utf8");
  assert.match(block, /const box = detail \? "min-h-24 p-4" : "min-h-24 p-3"/);
  assert.match(block, /kind === "loading"\) return \(\s*<div[^>]*\$\{box\}/);
  assert.match(browser, /canSeePrices \? <div className="min-h-24 min-w-0">/);
  assert.equal(galleryPriceView(template, undefined), null);
});
