import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildFolderVersionRows, type FolderVersionSource } from "./folder-versions";
import { QuotationFolderVersions } from "../../components/quotations/quotation-folder-versions";

const file = { orderNo: "CO-0002-001", quotationId: "q0", quotationNo: "QN-0002-001", folderNo: null, opportunityNo: null, clientId: "c", clientName: "Client", reference: "Office", total: 22800, currency: "AED", status: "Confirmed", createdAt: "2026-11-01T00:00:00Z", createdBy: "u", source: "quotation_layout_settings" };
const entry = (id: string, no: string, layout: object, extra: Partial<FolderVersionSource> = {}): FolderVersionSource => ({
  id, quotation_no: no, quotation_date: "2026-11-02", status: "client_confirmed", status_updated_at: "2026-11-03T00:00:00Z", currency: "AED", grand_total: 1000, approved_salesperson_id: null, layout_settings: layout, ...extra,
});
const live = [
  entry("v1", "QN-0002-001-V1", { variationOf: { orderNo: "CO-0002-001", projectQuotationId: "q0", snapshotId: "s", variationNo: 1, baseRevisionNo: 0 }, variationApplied: { orderNo: "CO-0002-001", variationNo: 1, appliedAt: "2026-11-04", projectVariationId: "pv" } }),
  entry("q0", "QN-0002-001", { projectFile: file }),
  entry("r1", "QN-0002-001-R1", {}, { status: "revised" }),
  entry("r2", "QN-0002-001-R2", {}),
];

test("live case: the locked view of QN-0002-001-V1 lists all four quotations of the folder", () => {
  const rows = buildFolderVersionRows(live, [], "v1", "CO-0002-001");
  assert.deepEqual(rows.map((row) => row.quotationNo), ["QN-0002-001-V1", "QN-0002-001", "QN-0002-001-R1", "QN-0002-001-R2"]);
  const byNo = Object.fromEntries(rows.map((row) => [row.quotationNo, row]));
  assert.equal(byNo["QN-0002-001-V1"].variationTag, "Variation R0 · V1");
  assert.equal(byNo["QN-0002-001-V1"].isCurrent, true);
  assert.equal(byNo["QN-0002-001-V1"].appliedTo, "Applied to Project CO-0002-001");
  assert.equal(byNo["QN-0002-001"].isProjectQuotation, true);
  assert.equal(rows.filter((row) => row.isProjectQuotation).length, 1);
  assert.equal(rows.filter((row) => row.isCurrent).length, 1);
  const html = renderToStaticMarkup(createElement(QuotationFolderVersions, { rows }));
  for (const id of ["v1", "q0", "r1", "r2"]) assert.ok(html.includes(`href="/quotations/${id}"`), id);
  assert.equal(html.match(/>Open</g)?.length, 4);
  assert.ok(html.includes("Open now") && html.includes("Project quotation") && html.includes("Variation R0 · V1") && html.includes("Applied to Project CO-0002-001"));
});

test("the Project's own quotation sees the same list; archived rows come after active ones; a single locked quotation is one row", () => {
  const rows = buildFolderVersionRows(live.slice(0, 2), [entry("old", "QN-0002-001-R0", {}, { status: "archived" })], "q0", "CO-0002-001");
  assert.deepEqual(rows.map((row) => [row.quotationNo, row.archived, row.isCurrent]), [["QN-0002-001-V1", false, false], ["QN-0002-001", false, true], ["QN-0002-001-R0", true, false]]);
  const html = renderToStaticMarkup(createElement(QuotationFolderVersions, { rows }));
  assert.ok(html.indexOf("Active") < html.indexOf("Archived"));
  assert.equal(buildFolderVersionRows([live[1]], [], "q0", "CO-0002-001").length, 1);
});

test("the page loads the folder list before the lock check and the locked view links back to the folders list", () => {
  const page = readFileSync("app/quotations/[id]/page.tsx", "utf8").split(String.fromCharCode(13)).join("");
  const lockAt = page.indexOf("if (isQuotationLocked(quotation)) {");
  assert.ok(page.indexOf("const folderQuotationList =") < lockAt && page.indexOf("const archivedFolderQuotations =") < lockAt);
  assert.equal(page.split("const folderQuotationList =").length, 2, "one folder query and list, shared by both paths");
  assert.ok(page.includes("folderVersions={folderVersions}"));
  const view = readFileSync("components/quotations/quotation-locked-view.tsx", "utf8");
  assert.ok(view.includes('href="/sales/quotations"') && view.includes("All quotation folders") && view.includes("<QuotationFolderVersions"));
});
