import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
const lines = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
const coverage = readFileSync("components/quotations/supplier-coverage-popup.tsx", "utf8");
const status = readFileSync("lib/products/supplier-family-status.ts", "utf8");

const trigger = (source: string, text: string) => {
  const match = source.match(new RegExp(`<button type="button" onClick=\\{([^\\n]*?)\\} className="([^"]+)">${text}</button>`));
  assert.ok(match, `trigger button not found: ${text}`);
  return { handler: match[1], classes: match[2].split(/\s+/) };
};
const focusRing = ["focus-visible:outline", "focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-emerald-800"];
const shared = ["mt-2", "rounded-md", "px-3", "py-1.5", "text-sm", "font-semibold", "max-w-full", "whitespace-normal", "break-words", "justify-self-start", ...focusRing];

test("'View price lines' is an outlined emerald button with the same click handler and the same words", () => {
  const button = trigger(lines, "View price lines");
  assert.equal(button.handler, "(event) => { event.stopPropagation(); load(); }", "same handler as before");
  for (const name of [...shared, "border", "border-emerald-700", "bg-white", "text-emerald-900"]) assert.ok(button.classes.includes(name), name);
  assert.ok(!button.classes.includes("underline") && !button.classes.includes("bg-emerald-800"));
  assert.match(lines, /type="button" onClick=\{\(event\) => \{ event\.stopPropagation\(\); load\(\); \}\}/);
});

test("'Add this product to a Supplier price list' is a solid emerald button with the same click handler and the same words", () => {
  const button = trigger(coverage, "\\{detail\\}");
  assert.equal(button.handler, "(event) => { event.stopPropagation(); setOpen(true); }", "same handler as before");
  for (const name of [...shared, "bg-emerald-800", "text-white"]) assert.ok(button.classes.includes(name), name);
  assert.ok(!button.classes.includes("underline") && !button.classes.includes("border-emerald-700"));
  // The words still come from the status engine, unchanged.
  assert.match(status, /detail: "Add this product to a Supplier price list"/);
  assert.match(status, /label: "Not covered by a Supplier price list"/);
  // A role that may not add products still gets the read-only note, not a button.
  assert.match(coverage, /allowed === false \? "Ask a Supplier price manager to add this product to a Supplier price list\."/);
});

test("both are real buttons, not links, shown in the header and in the right column through the same badge", () => {
  for (const source of [lines, coverage]) {
    assert.doesNotMatch(source, /<a [^>]*>|from "next\/link"|<Link\b/, "no link element");
  }
  // They are rendered by the non-compact badge only; both detail views use it, the product list does not.
  assert.match(selector, /\{!compact \? supplierPresentation\?\.actionHref \? <SupplierCoverageAction /);
  assert.match(selector, /\{!compact && supplierPresentation && !supplierPresentation\.actionHref \? <SupplierPriceLinesAction /);
  assert.equal((selector.match(/<PriceCheckBadge template=\{template\} onSupplierStatus=\{updateSupplierStatus\} \/>/g) ?? []).length, 2, "header and right column");
  assert.equal((selector.match(/<PriceCheckBadge compact template=\{template\} \/>/g) ?? []).length, 1, "the product list stays compact, without these buttons");
  // The button sits on its own line after the badge: the badge wrapper is a grid and the button is its last child.
  assert.match(selector, /<span className=\{compact \? "mt-1 block" : "grid gap-1"\}>/);
  assert.ok(selector.indexOf("<SupplierCoverageAction") > selector.indexOf("{health.label}</span>"));
});

test("the legacy buttons and the reload wording are unchanged", () => {
  assert.match(selector, /className="rounded-md border border-amber-300 bg-white px-3 py-1\.5 text-\[11px\] font-semibold text-amber-900 transition hover:border-amber-500"\s*>\s*Check \/ Update Price/);
  assert.match(selector, /className="rounded-md border border-emerald-200 bg-white px-3 py-1\.5 text-\[11px\] font-semibold text-emerald-900 transition hover:border-emerald-500 disabled:cursor-not-allowed[^"]*"\s*>\s*\{isTemplateActionPending \? "Saving\.\.\." : "Mark as Checked"\}/);
  assert.match(selector, /className="rounded-md border border-zinc-300 bg-white px-3 py-1\.5 text-\[11px\] font-semibold text-zinc-700 transition hover:border-emerald-500 hover:text-emerald-900"\s*>\s*Edit Template/);
  assert.match(selector, /title="Reload the page to try again"/);
  assert.match(selector, /Supplier price status unavailable/);
});
