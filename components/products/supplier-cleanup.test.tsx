import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupplierCleanup } from "@/lib/products/supplier-cleanup";

mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh() {}, push() {}, replace() {} }) } });
const act = () => Promise.resolve({});
mock.module(new URL("../../app/products/price-updates/supplier-sources/actions.ts", import.meta.url).href, { namedExports: { deletePreviousSupplierSource: act, deleteSupplierSourceDefinition: act, leaveSupplierReview: act } });

const cleanup: SupplierCleanup = {
  oldLists: [
    { id: "a", title: "Interstuhl 26 Oct", filename: "old.csv", importedOn: "2026-10-26", lines: 1626, currentSourceId: "c", removable: true, reason: "Safe to delete: no completed review, no applied prices and no saved review decisions.", openReviews: 0, archived: false },
    { id: "b", title: "Interstuhl 30 Oct", filename: "x.xlsx", importedOn: "2026-10-30", lines: 2702, currentSourceId: "c", removable: false, reason: "Protected: it is used in completed price history.", openReviews: 1, archived: false },
  ],
  staleReviews: [{ batchId: "r1", sourceId: "b", title: "Interstuhl 30 Oct", filename: "x.xlsx", statusLabel: "Open" }],
  unusedDefinitions: [{ id: "d2", name: "Interstuhl every", removable: true }, { id: "d3", name: "LAS Chairs", removable: true }],
};
const render = async (extra: Record<string, boolean> = {}, data: SupplierCleanup = cleanup) => {
  const { SupplierCleanupPanel } = await import("./supplier-cleanup");
  return renderToStaticMarkup(<SupplierCleanupPanel brandId="b" brandName="Interstuhl" cleanup={data} canDeleteLists canLeaveReviews canDeleteDefinitions {...extra} />);
};

test("the System Owner sees the summary, each list with its reason, and the remove buttons only where allowed", async () => {
  const html = await render();
  assert.match(html, /2 old lists|1 old list, 1 stale review, 2 unused definitions can be cleaned up/);
  assert.match(html, /old\.csv/); assert.match(html, /1,626 lines/); assert.match(html, /Safe to delete/); assert.match(html, /used in completed price history/);
  assert.equal(html.split("Delete…").length - 1, 3); // the safe list + two definitions; the protected list has no button
  assert.match(html, /Leave review…/); assert.match(html, /Product history are never changed/);
});

test("people who cannot manage supplier capacity see the lists read only", async () => {
  const html = await render({ canDeleteLists: false, canLeaveReviews: false, canDeleteDefinitions: false });
  assert.doesNotMatch(html, /Delete…|Leave review…/);
  assert.match(html, /Only the System Owner can delete old price lists/);
  assert.match(html, /Interstuhl 26 Oct/);
});

test("an approver who is not the System Owner can leave a review but not delete a list", async () => {
  const html = await render({ canDeleteLists: false });
  assert.match(html, /Leave review…/); assert.equal(html.split("Delete…").length - 1, 2); // only the two definitions
});

test("nothing to clean up shows plain empty states", async () => {
  const html = await render({}, { oldLists: [], staleReviews: [], unusedDefinitions: [] });
  assert.match(html, /Nothing to clean up/); assert.match(html, /No old price lists/); assert.match(html, /No stale reviews/); assert.match(html, /No unused definitions/);
});
