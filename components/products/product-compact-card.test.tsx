import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductCompactCard, productCardGridClass } from "./product-compact-card";

mock.module("next/navigation", {
  namedExports: { usePathname: () => "/products/templates", useRouter: () => ({ replace() {}, push() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() },
});

const card = (extra: Partial<Parameters<typeof ProductCompactCard>[0]> = {}) => renderToStaticMarkup(
  <ProductCompactCard badge={<span>active</span>} editHref="/edit" imageCount={3} media={<img alt="x" src="/a.png" />} metaLine="LAS MOBILI · Desk / Executive Desk" openHref="/open" title="Anna desk" {...extra} />,
);

test("a card with no code and no description has neither line, and keeps both buttons and the image badge", () => {
  const html = card();
  assert.doesNotMatch(html, /No description available\.|No template or item code/);
  assert.match(html, /href="\/open"[^>]*>View Details</); assert.match(html, /href="\/edit"[^>]*>Edit Template</);
  assert.match(html, /3 images/); assert.match(html, />active</);
  assert.match(html, /title="LAS MOBILI · Desk \/ Executive Desk"/); assert.match(html, /truncate/);
  assert.match(html, /h-8/);
});

test("a code and a one-line description show only when they exist", () => {
  const html = card({ codeLine: "T-1 / I-9", descriptionLine: "A long desk" });
  assert.match(html, /T-1 \/ I-9/); assert.match(html, /A long desk/);
});

test("Page B extras: price status and menu render in the card, the grid keeps 4 columns on wide screens", () => {
  const html = card({ status: <div>Price current</div>, menu: <button aria-label="More actions" />, checkbox: <input type="checkbox" aria-label="Select" /> });
  assert.match(html, /Price current/); assert.match(html, /More actions/); assert.match(html, /type="checkbox"/);
  assert.match(productCardGridClass, /sm:grid-cols-2/); assert.match(productCardGridClass, /xl:grid-cols-3/); assert.match(productCardGridClass, /2xl:grid-cols-4/);
});

test("the Product Library toolbar has one Open Product Management link, one search and the brand chips, and no title card or info box", async () => {
  const { ProductLibraryBrowseControls } = await import("./product-library-browse-controls");
  const html = renderToStaticMarkup(
    <ProductLibraryBrowseControls brandOptions={[{ id: "b", label: "COLAN", count: 1 }]} categoryOptions={[]} subCategoryOptions={[]} resultCount={8} searchQuery="" selectedBrandId="" selectedCategoryId="" selectedSubCategoryId="" />,
  );
  assert.equal(html.split("Open Product Management").length - 1, 1);
  assert.match(html, /type="search"/); assert.match(html, /All Brands/); assert.match(html, /COLAN 1/); assert.match(html, /8 products found/);
  assert.doesNotMatch(html, /Browse reusable product templates|uppercase/);
});
