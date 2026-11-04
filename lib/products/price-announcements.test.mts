import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  announcedQuotationDelta, announcedSnapshot, announcedSnapshotOf, announcedTotals, announcementBadge, announcementBanner, announcementItemNote, announcementTickText, announcementView,
  announcementViewsFromRows, officialListReceived, oneOpenNoticeText, parseAnnouncementPercent, roundHalfUp2, signedPercent, withAnnouncedPercent, type AnnouncementFacts, type AnnouncementRow,
} from "./price-announcements.js";
import { quotationMoneyValue, ruleConvertedPrice } from "../quotation-pricing.js";

const notice: AnnouncementRow = { id: "n1", brandId: "b1", percent: 3, effectiveFrom: "2026-12-01", note: "Supplier email", approximate: true };
const coded = (latest: string | null): AnnouncementFacts => ({ priceCheckMode: "supplier_codes", latestSupplierList: latest, latestManualRelease: "2030-01-01" });
const manual = (latest: string | null): AnnouncementFacts => ({ priceCheckMode: "manual", latestSupplierList: "2030-01-01", latestManualRelease: latest });

test("rounding is half up to 2 decimals", () => {
  assert.equal(withAnnouncedPercent(319, 3), 328.57);
  assert.equal(roundHalfUp2(1.515), 1.52); assert.equal(roundHalfUp2(1.514), 1.51); assert.equal(roundHalfUp2(1.005), 1.01);
  assert.equal(withAnnouncedPercent(150, 1), 151.5); assert.equal(withAnnouncedPercent(1.5, 1), 1.52);
  assert.equal(withAnnouncedPercent(100, 2.125), 102.13); // 3 decimals in the percent
});

test("a negative percent lowers the price", () => {
  assert.equal(withAnnouncedPercent(319, -3), 309.43);
  assert.equal(withAnnouncedPercent(200, -2.5), 195);
});

test("the wording: banner, badge, tick box and item note", () => {
  assert.equal(announcementBanner(notice), "Price rise of about 3% announced from 1 Dec 2026 (approximate). New price list not received yet.");
  assert.equal(announcementBanner({ ...notice, approximate: false }), "Price rise of 3% announced from 1 Dec 2026. New price list not received yet.");
  assert.equal(announcementBanner({ ...notice, percent: -2.5 }), "Price drop of about 2.5% announced from 1 Dec 2026 (approximate). New price list not received yet.");
  assert.equal(announcementBadge(notice), "+3% announced from 1 Dec 2026");
  assert.equal(announcementBadge({ ...notice, percent: -2.5 }), "-2.5% announced from 1 Dec 2026");
  assert.equal(announcementTickText(notice), "Add announced +3% (approximate)");
  assert.equal(announcementTickText({ ...notice, approximate: false }), "Add announced +3%");
  assert.equal(announcementItemNote(notice), "Includes announced +3% (approximate)");
  assert.equal(signedPercent(2.125), "+2.125%");
});

test("official list received: a coded Brand looks only at its imported lists", () => {
  assert.equal(officialListReceived(notice, coded(null)), false);
  assert.equal(officialListReceived(notice, coded("2026-11-30")), false);
  assert.equal(officialListReceived(notice, coded("2026-12-01")), true); // the same date counts
  assert.equal(officialListReceived(notice, coded("2027-01-15")), true);
  assert.equal(officialListReceived(notice, undefined), false);
});

test("official list received: a manual Brand looks only at its recorded releases", () => {
  assert.equal(officialListReceived(notice, manual(null)), false);
  assert.equal(officialListReceived(notice, manual("2026-11-30")), false);
  assert.equal(officialListReceived(notice, manual("2026-12-01")), true);
  assert.equal(announcementView(notice, manual("2026-12-01")).state, "official_list_received");
  assert.equal(announcementView(notice, manual("2026-11-01")).state, "active");
});

test("database rows become one view per Brand", () => {
  const views = announcementViewsFromRows([{
    notices: [{ id: "n1", brand_id: "b1", percent: "3.000", effective_from: "2026-12-01", note: "", approximate: true, created_by_name: " Sara " }, { id: "n2", brand_id: "b2", percent: -1, effective_from: "2026-12-01", note: "x", approximate: false }],
    brands: [{ brand_id: "b1", price_check_mode: "supplier_codes", latest_supplier_list: "2026-12-05", latest_manual_release: null }, { brand_id: "b2", price_check_mode: "manual", latest_supplier_list: "2027-01-01", latest_manual_release: null }],
  }]);
  assert.equal(views.get("b1")?.percent, 3); assert.equal(views.get("b1")?.state, "official_list_received"); assert.equal(views.get("b1")?.createdByName, "Sara");
  assert.equal(views.get("b2")?.state, "active"); // a manual Brand ignores Supplier lists
  assert.equal(views.get("b2")?.approximate, false);
});

test("the form's percent", () => {
  assert.deepEqual(parseAnnouncementPercent("3"), { percent: 3 });
  assert.deepEqual(parseAnnouncementPercent(" -2.5% "), { percent: -2.5 });
  assert.deepEqual(parseAnnouncementPercent("+2.125"), { percent: 2.125 });
  for (const bad of ["", "abc", "0", "-100", "101", "1.2345", "1e2"]) assert.ok("error" in parseAnnouncementPercent(bad), bad);
});

test("the percent applies to the supplier totals per currency, before conversion, and leaves other Brands' linked products alone", () => {
  const single = announcedTotals({ totals: { EUR: 319 }, percent: 3 });
  assert.deepEqual(single.uplifted, { EUR: 328.57 }); assert.deepEqual(single.delta, { EUR: 9.57 }); assert.deepEqual(single.original, { EUR: 319 });
  assert.equal(announcedQuotationDelta(single.delta, { EUR: "4" }), 38.28);
  const withLinked = announcedTotals({ totals: { AED: 300 }, excluded: { AED: 100 }, percent: 10 });
  assert.deepEqual(withLinked.uplifted, { AED: 320 }); // only the Brand's own 200 goes up
  const mixed = announcedTotals({ totals: { AED: 100, EUR: 100 }, percent: 3 });
  assert.equal(announcedQuotationDelta(mixed.delta, new Map([["EUR", 4]])), 15);
});

test("an AED item: the price is raised before the company's round up to 5; un-ticking restores it", () => {
  const base = 319;
  const ticked = base + announcedQuotationDelta(announcedTotals({ totals: { AED: base }, percent: 3 }).delta, {});
  assert.equal(ticked, 328.57);
  assert.equal(quotationMoneyValue(ticked), 330);
  assert.equal(quotationMoneyValue(base), 320);
});

test("a whole AED quotation: 319.00 at +3% is 328.57, then the nearest whole AED, not 330", () => {
  const ticked = 319 + announcedQuotationDelta(announcedTotals({ totals: { AED: 319 }, percent: 3 }).delta, {});
  assert.equal(ruleConvertedPrice("whole_aed_v1", ticked), 329);
  assert.equal(ruleConvertedPrice("whole_aed_v1", 319), 319);
  assert.equal(ruleConvertedPrice("round_up_5_legacy", ticked), 330); // legacy is unchanged
  const eur = announcedTotals({ totals: { EUR: 379.04 }, percent: 3 });
  assert.deepEqual(eur.uplifted, { EUR: 390.41 }); // the supplier price keeps 2 decimals until it is converted
  assert.equal(ruleConvertedPrice("whole_aed_v1", 379.04 * 4.1 + announcedQuotationDelta(eur.delta, { EUR: 4.1 })), 1601);
});

test("the item record explains the price; items and drafts without it stay valid", () => {
  const snapshot = announcedSnapshot(notice, announcedTotals({ totals: { EUR: 319 }, percent: 3 }));
  assert.deepEqual(snapshot, { notice_id: "n1", percent: 3, approximate: true, effective_from: "2026-12-01", note: "Supplier email", note_text: "Includes announced +3% (approximate)", original_totals: { EUR: 319 }, uplifted_totals: { EUR: 328.57 } });
  assert.deepEqual(announcedSnapshotOf({ announced_price_change: snapshot }), snapshot);
  for (const old of [null, undefined, "text", {}, { source_price_reference: {} }, { announced_price_change: "x" }]) assert.equal(announcedSnapshotOf(old), null);
});

test("the migration: one open notice per Brand, never deleted, approver only, and it writes no price", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261106100000_brand_price_announcements.sql", import.meta.url), "utf8");
  assert.match(sql, /create unique index brand_price_announcements_one_open on public\.brand_price_announcements\(brand_id\) where status = 'open'/);
  assert.ok(sql.includes(oneOpenNoticeText), "the database refuses with the same words");
  assert.match(sql, /cannot be deleted/);
  assert.match(sql, /alter table public\.brand_price_announcements enable row level security/);
  for (const name of ["brand_price_announcement_add", "brand_price_announcement_end"]) assert.match(sql, new RegExp(`create function public\\.${name}[\\s\\S]*?current_user_can_approve_brand_prices`));
  assert.doesNotMatch(sql, /update public\.product_templates|write_product_price|apply_supplier|product_template_price_history|update public\.brands/);
});

test("no price write anywhere in the notice code", () => {
  for (const file of ["./price-announcements.ts", "../../components/products/price-announcement-actions.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /product_templates|write_product_price|apply_supplier|supplierApply|\.update\(|\.insert\(/);
  }
});

test("the shared builder's server action re-reads the notice instead of trusting the browser", () => {
  const actions = readFileSync(new URL("../../app/quotations/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /loadBrandPriceAnnouncements\(supabase, \[template\.brand_id\]\)/);
  assert.match(actions, /announcedNotice\.state !== "active"/);
  assert.doesNotMatch(actions, /formData\.get\("announced_percent"\)|"announced_percent"/);
});
