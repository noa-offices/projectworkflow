import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandPriceCheckMethodField, PriceCheckModeLabel, SUPPLIER_LISTS_WARNING, showSupplierListsWarning } from "./brand-price-check-method";
import { ManualPriceCheckPanel } from "./manual-price-check-panel";

const checkedInput = (html: string, value: string) => (html.match(/<input[^>]*>/g) ?? []).some((tag) => tag.includes(`value="${value}"`) && tag.includes("checked"));

test("Edit brand form: approvers get two radio choices with a short sentence each", () => {
  const html = renderToStaticMarkup(<BrandPriceCheckMethodField currentMode="supplier_codes" canChange hasSupplierLists={false} />);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  assert.match(html, /name="price_check_mode"/);
  assert.match(html, /Supplier price list with codes/); assert.match(html, /Manual, for brands without codes/);
  assert.equal(checkedInput(html, "supplier_codes"), true); assert.equal(checkedInput(html, "manual"), false);
});

test("Edit brand form: the current method is selected for a manual brand", () => {
  assert.equal(checkedInput(renderToStaticMarkup(<BrandPriceCheckMethodField currentMode="manual" canChange hasSupplierLists />), "manual"), true);
});

test("Edit brand form: other people see the method read only and nothing is submitted", () => {
  const html = renderToStaticMarkup(<BrandPriceCheckMethodField currentMode="manual" canChange={false} hasSupplierLists />);
  assert.doesNotMatch(html, /<input/);
  assert.match(html, /Manual, for brands without codes/); assert.match(html, /Only people who approve brand prices can change this/);
});

test("warning shows only when switching to Manual on a brand with supplier price lists, and never blocks", () => {
  assert.equal(showSupplierListsWarning("manual", "supplier_codes", true), true);
  assert.equal(showSupplierListsWarning("manual", "supplier_codes", false), false);
  assert.equal(showSupplierListsWarning("supplier_codes", "supplier_codes", true), false);
  assert.equal(showSupplierListsWarning("manual", "manual", true), false);
  assert.equal(SUPPLIER_LISTS_WARNING, "This brand already has supplier price lists. Manual checks will replace them for status badges.");
  assert.doesNotMatch(renderToStaticMarkup(<BrandPriceCheckMethodField currentMode="supplier_codes" canChange hasSupplierLists />), /role="status"/); // not shown until Manual is chosen
});

test("Brand card label says Codes or Manual", () => {
  assert.match(renderToStaticMarkup(<PriceCheckModeLabel mode="supplier_codes" />), />Codes</);
  assert.match(renderToStaticMarkup(<PriceCheckModeLabel mode="manual" />), />Manual</);
});

test("Price Updates card: read-only method line with an Edit brand link, no switch button", () => {
  const props = { brandId: "b1", brandName: "Colan", releases: [], today: "2026-11-05" };
  const manual = renderToStaticMarkup(<ManualPriceCheckPanel {...props} manual canManage />);
  assert.match(manual, /Price check method: <span[^>]*>Manual</); assert.match(manual, /href="\/products\/brands\?brand=b1&amp;editBrand=b1"/);
  assert.match(manual, /New price list released/); assert.doesNotMatch(manual, /Use Supplier codes instead|Use manual price checks/);
  const codes = renderToStaticMarkup(<ManualPriceCheckPanel {...props} manual={false} canManage />);
  assert.match(codes, />Codes</); assert.doesNotMatch(codes, /Use manual price checks|New price list released/);
  const viewer = renderToStaticMarkup(<ManualPriceCheckPanel {...props} manual canManage={false} />);
  assert.doesNotMatch(viewer, /Edit brand|New price list released/);
});
