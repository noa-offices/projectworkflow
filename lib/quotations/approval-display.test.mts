import assert from "node:assert/strict";
import test from "node:test";
import { quotationApprovalDisplay } from "./approval-display";
import { folderProjectOrderNo, folderProjectOrderNoFrom, folderProjectOrderNos } from "./project-variation";

const projectFile = { orderNo: "CO-0002-001", quotationId: "q", quotationNo: "QN-0002-001", clientId: "c", clientName: "Client", reference: "Office", total: 100, currency: "AED", createdAt: "2026-11-04", createdBy: "u" };
const variationOf = { orderNo: "CO-0002-001", projectQuotationId: "q", snapshotId: "s", variationNo: 1, baseRevisionNo: 0 };
const confirmed = (layout_settings: unknown, approved_salesperson_id: string | null = "sales") => ({ status: "client_confirmed", approved_salesperson_id, layout_settings });

test("before a Project exists: still Project File Pending", () => {
  for (const folder of [undefined, null]) {
    const display = quotationApprovalDisplay(confirmed({}), folder);
    assert.equal(display?.state, "project_file_pending");
    assert.equal(display?.label, "Client Confirmed · Project File Pending");
  }
});

test("the Project's own quotation and a variation are unchanged, whatever the folder says", () => {
  assert.equal(quotationApprovalDisplay(confirmed({ projectFile }), "CO-0002-001")?.state, "approved");
  assert.equal(quotationApprovalDisplay(confirmed({ projectFile }, null), "CO-0002-001")?.state, "owner_attribution_pending");
  assert.deepEqual(quotationApprovalDisplay(confirmed({ variationOf }), "CO-0002-001"), { badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-800", label: "Variation Confirmed", state: "approved" });
});

test("an old revision or option in a folder that has a Project gets the grey label and a state that is not pending", () => {
  const display = quotationApprovalDisplay(confirmed({}), "CO-0002-001");
  assert.deepEqual(display, { badgeClassName: "border-zinc-200 bg-zinc-100 text-zinc-600", label: "Client Confirmed · Folder has Project CO-0002-001", state: "folder_has_project" });
  assert.notEqual(display?.state, "project_file_pending");
  assert.equal(quotationApprovalDisplay(confirmed({}, null), "CO-0002-001")?.state, "folder_has_project"); // without a salesperson too
});

test("other statuses are unchanged", () => {
  for (const status of ["draft", "sent_to_client", "cancelled", "on_hold", "archived"]) assert.equal(quotationApprovalDisplay({ status, approved_salesperson_id: null, layout_settings: {} }, "CO-0002-001"), null, status);
});

test("the folder's Project is found for revisions, options and variations, and never from another folder", () => {
  const rows = [
    { quotation_no: "QN-0002-001", layout_settings: { projectFile } },
    { quotation_no: "QN-0002-001-R2", layout_settings: {} },
    { quotation_no: "QN-0002-001-OPT1", layout_settings: {} },
    { quotation_no: "QN-0003-001-R1", layout_settings: {} },
    { quotation_no: null, layout_settings: {} },
  ];
  const orders = folderProjectOrderNos(rows as never[]);
  assert.equal(folderProjectOrderNoFrom(orders, "QN-0002-001-R2"), "CO-0002-001");
  assert.equal(folderProjectOrderNoFrom(orders, "QN-0002-001-OPT1"), "CO-0002-001");
  assert.equal(folderProjectOrderNoFrom(orders, "QN-0003-001-R1"), null);
  assert.equal(folderProjectOrderNoFrom(orders, null), null);
  assert.equal(folderProjectOrderNo(rows as never[], "QN-0002-001-R2"), "CO-0002-001");
});
