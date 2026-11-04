import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnnouncementView } from "@/lib/products/price-announcements";
import { AnnouncedPriceBadge } from "./announced-price-badge";
import { ProductCompactCard } from "./product-compact-card";

mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {}, push() {}, replace() {} }) } });
const notice: AnnouncementView = { id: "n1", brandId: "b1", percent: 3, effectiveFrom: "2026-12-01", note: "", approximate: true, state: "active" };
const panel = async (extra: Record<string, unknown> = {}) => {
  const { BrandPriceAnnouncementPanel } = await import("./price-announcement-panel");
  return renderToStaticMarkup(<BrandPriceAnnouncementPanel brandId="b1" brandName="Interstuhl" announcement={notice} canManage today="2026-11-04" {...extra} />);
};

test("an approver sees the banner and Cancel notice; adding another is blocked with the plain reason", async () => {
  const html = await panel();
  assert.match(html, /Price rise of about 3% announced from 1 Dec 2026 \(approximate\)\. New price list not received yet\./);
  assert.match(html, /Cancel notice/); assert.match(html, /Close notice/);
  assert.match(html, /disabled=""[^>]*title="This Brand already has an open notice/);
});

test("others see the banner only; with no notice they see nothing", async () => {
  const html = await panel({ canManage: false });
  assert.match(html, /Price rise of about 3%/); assert.doesNotMatch(html, /Cancel notice|Announce price change/);
  assert.equal(await panel({ canManage: false, announcement: null }), "");
});

test("an approver with no notice can announce", async () => {
  const html = await panel({ announcement: null });
  assert.match(html, /Announce price change/); assert.doesNotMatch(html, /disabled=""/); assert.doesNotMatch(html, /Price rise/);
});

test("official list received: no banner, and the approver can close it", async () => {
  const html = await panel({ announcement: { ...notice, state: "official_list_received" } });
  assert.match(html, /Official list received/); assert.match(html, /Close notice/); assert.doesNotMatch(html, /New price list not received yet|Cancel notice/);
});

test("the badge is information only, and is hidden once the official list is in", () => {
  assert.match(renderToStaticMarkup(<AnnouncedPriceBadge announcement={notice} />), /\+3% announced from 1 Dec 2026/);
  assert.equal(renderToStaticMarkup(<AnnouncedPriceBadge announcement={{ ...notice, state: "official_list_received" }} />), "");
  assert.equal(renderToStaticMarkup(<AnnouncedPriceBadge announcement={null} />), "");
});

test("product cards show the badge; without a notice the card has none", () => {
  const card = (announcement: AnnouncementView | null) => renderToStaticMarkup(<ProductCompactCard announcement={announcement} badge={<span>active</span>} editHref="/e" imageCount={1} media={<div />} metaLine="Brand" openHref="/o" title="Chair" />);
  assert.match(card(notice), /\+3% announced from 1 Dec 2026/);
  assert.doesNotMatch(card(null), /announced/);
});
