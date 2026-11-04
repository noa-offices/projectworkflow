import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { announcedQuotationDelta, announcedSnapshot, announcedTotals, type AnnouncementView } from "@/lib/products/price-announcements";
import { quotationMoneyValue } from "@/lib/quotation-pricing";
import { AnnouncedPriceTick } from "./announced-price-tick";

const notice: AnnouncementView = { id: "n1", brandId: "b1", percent: 3, effectiveFrom: "2026-12-01", note: "", approximate: true, state: "active" };
const format = (currency: string, amount: number) => `${currency} ${amount}`;

/** The checkbox element inside a rendered tree. This project has no browser DOM in its unit tests, so the handler is called directly. */
function findInput(node: ReactNode): ReactElement<{ type?: string; checked?: boolean; onChange: (event: { target: { checked: boolean } }) => void }> | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const element = child as ReactElement<{ type?: string; children?: ReactNode; checked?: boolean; onChange: (event: { target: { checked: boolean } }) => void }>;
    if (element.type === "input") return element;
    const found = findInput(element.props.children);
    if (found) return found;
  }
  return null;
}

/** The same calculation the selector does for one AED item, driven by the tick box. */
function itemWithTick(base: number, ticked: boolean) {
  const change = ticked ? announcedTotals({ totals: { AED: base }, percent: notice.percent }) : null;
  const raw = base + (change ? announcedQuotationDelta(change.delta, {}) : 0);
  return { unit_price: quotationMoneyValue(raw), source_component_data: { source_price_reference: { original_source_totals: { AED: base } }, ...(change ? { announced_price_change: announcedSnapshot(notice, change) } : {}) } };
}

test("the tick box is off by default and names the percent", () => {
  const html = renderToStaticMarkup(<AnnouncedPriceTick announcement={notice} checked={false} onChange={() => {}} formatAmount={format} />);
  assert.match(html, /Add announced \+3% \(approximate\)/);
  assert.doesNotMatch(html, /checked=""/);
  assert.doesNotMatch(html, /Includes announced/);
});

test("ticking raises the item price and records the uplift; un-ticking restores it; the library price stays in the record", () => {
  let ticked = false;
  const tree = () => AnnouncedPriceTick({ announcement: notice, checked: ticked, onChange: (value) => { ticked = value; }, formatAmount: format });
  assert.deepEqual(itemWithTick(319, ticked), { unit_price: 320, source_component_data: { source_price_reference: { original_source_totals: { AED: 319 } } } });

  findInput(tree())!.props.onChange({ target: { checked: true } });
  assert.equal(ticked, true);
  const raised = itemWithTick(319, ticked);
  assert.equal(raised.unit_price, 330);
  assert.equal(raised.source_component_data.announced_price_change?.notice_id, "n1");
  assert.equal(raised.source_component_data.announced_price_change?.percent, 3);
  assert.equal(raised.source_component_data.announced_price_change?.note_text, "Includes announced +3% (approximate)");
  assert.deepEqual(raised.source_component_data.announced_price_change?.uplifted_totals, { AED: 328.57 });
  assert.deepEqual(raised.source_component_data.source_price_reference.original_source_totals, { AED: 319 });

  findInput(tree())!.props.onChange({ target: { checked: false } });
  assert.equal(ticked, false);
  assert.equal(itemWithTick(319, ticked).unit_price, 320);
  assert.equal(itemWithTick(319, ticked).source_component_data.announced_price_change, undefined);
});

test("when ticked it says what is included", () => {
  const html = renderToStaticMarkup(<AnnouncedPriceTick announcement={notice} checked onChange={() => {}} upliftedTotals={{ EUR: 328.57 }} formatAmount={format} />);
  assert.match(html, /checked=""/); assert.match(html, /Includes announced \+3% \(approximate\)/); assert.match(html, /EUR 328\.57/); assert.match(html, /library price is not changed/);
});

test("a closed or superseded notice offers no tick box; a kept quote price disables it", () => {
  assert.equal(renderToStaticMarkup(<AnnouncedPriceTick announcement={{ ...notice, state: "official_list_received" }} checked={false} onChange={() => {}} formatAmount={format} />), "");
  assert.equal(renderToStaticMarkup(<AnnouncedPriceTick announcement={null} checked={false} onChange={() => {}} formatAmount={format} />), "");
  assert.match(renderToStaticMarkup(<AnnouncedPriceTick announcement={notice} checked={false} onChange={() => {}} blockedReason="Kept" formatAmount={format} />), /disabled=""/);
});

test("the selector applies it before conversion and rounding, and records it on the item", () => {
  const source = readFileSync(new URL("./product-library-selector.tsx", import.meta.url), "utf8");
  assert.match(source, /announcedTotals\(\{ totals: Object\.fromEntries\(originalCurrencyTotals\), excluded: otherBrandTotals, percent: activeAnnouncement\.percent \}\)/);
  assert.match(source, /announced_price_change: announcedSnapshot\(activeAnnouncement, announcedChange\)/);
  assert.ok(source.indexOf("const announcedChange =") < source.indexOf("const previewUnitPriceWithConversion ="), "before the quotation rounding");
  assert.ok(source.indexOf("const previewUnitPriceWithConversion =") < source.indexOf("const unitDiscountAmount ="), "before the discount");
});
