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

test("Page B card: the price status badge is on the image, its long note is a tooltip and not a row, checkbox and menu render", () => {
  const html = card({ statusBadge: <span title="Price checked - Checked on 31 Oct 2026 by Junais KP">Price checked</span>, menu: <button aria-label="More actions" />, checkbox: <input type="checkbox" aria-label="Select" /> });
  const image = html.slice(html.indexOf("relative flex h-28"), html.indexOf("</div>", html.indexOf("relative flex h-28")));
  assert.match(image, /Price checked/); assert.match(image, /type="checkbox"/); assert.match(image, />active</);
  assert.match(image, /left-7/);
  const body = html.slice(html.indexOf("p-3"));
  assert.doesNotMatch(body, /Checked on 31 Oct 2026 by Junais KP</); // only the tooltip (title) has the note
  assert.match(html, /title="Price checked - Checked on 31 Oct 2026 by Junais KP"/);
  assert.match(html, /More actions/);
});

test("Page A card (no price status) has no status wrapper on the image and is otherwise the same", () => {
  const html = card();
  assert.doesNotMatch(html, /left-7/);
  assert.match(html, /View Details/); assert.match(html, /3 images/);
});

test("the grid keeps 4 columns on very wide screens", () => {
  assert.match(productCardGridClass, /@min-.576px.:grid-cols-2/); assert.match(productCardGridClass, /@min-.896px.:grid-cols-3/); assert.match(productCardGridClass, /@min-.1040px.:grid-cols-4/);
});

test("the Product Management toolbar has one Add Product Template button, search, four dropdowns, small chips and the bulk buttons", async () => {
  const action = () => {};
  mock.module(new URL("../../app/products/templates/actions.ts", import.meta.url).href, { namedExports: { archiveProductTemplate: action, bulkArchiveProductTemplates: action, markProductTemplateDiscontinued: action, markTemplatePriceChecked: action } });
  const { ProductManagementFilterProvider } = await import("./product-management-template-results");
  const { ProductManagementFilterBar } = await import("./product-management-filter-bar");
  const rows = [{ id: "1", brandId: "b", mainCategoryId: "", priceKey: "current", subCategoryId: "" }] as never[];
  const html = renderToStaticMarkup(
    <ProductManagementFilterProvider initialFilters={{ brand: "", main: "", priceStatus: "", q: "", sub: "" }} mainCategories={[]} rows={rows} subCategories={[]}>
      <ProductManagementFilterBar addBrandHref="/brands" addTemplateHref="/add" brandOptions={[{ id: "b", name: "Arca" }]} markVisibleAction={() => {}} />
    </ProductManagementFilterProvider>,
  );
  assert.equal(html.split("+ Add Product Template").length - 1, 1);
  assert.equal(html.split("+ Add Brand").length - 1, 1);
  assert.match(html, /type="search"/); assert.match(html, /Reset filters/); assert.match(html, /Mark visible templates checked now/);
  for (const label of ["Brand", "Main category", "Sub category", "Price status"]) assert.match(html, new RegExp(`aria-label="${label}"`));
  for (const chip of ["Total", "Current", "Needs check", "Due", "No price list date"]) assert.match(html, new RegExp(chip));
  assert.doesNotMatch(html, /Total:|aria-pressed/); // chips are information only, as before
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
