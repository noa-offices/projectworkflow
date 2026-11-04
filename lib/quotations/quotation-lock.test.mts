import assert from "node:assert/strict";
import test from "node:test";
import { isQuotationLocked, quotationLockReason, isLockedQuotationUpdateAllowed, lockedSourceCopySettings, unlockedQuotationCopyLayoutSettings } from "./quotation-lock.js";
import { branchLayoutSettings, newEnquiryCopyLayoutSettings } from "./quotation-layout-copy.js";

export const projectFile = { orderNo: "OR-2026-001", quotationId: "quote", quotationNo: "Q-001", clientId: "client", clientName: "Client", reference: "Office", total: 1468.95, currency: "AED", createdAt: "2026-11-04", createdBy: "user" };
const locked = { status: "client_confirmed", layout_settings: { projectFile, pricing_rule: "whole_aed_v1", price_rounding: { step: 5 }, documentSetup: { commercial: { currency: "AED" } } } };

test("only a valid Project File locks a quotation", () => {
  assert.equal(isQuotationLocked(locked), true);
  assert.equal(quotationLockReason(locked), "Locked: Project OR-2026-001 was created from this quotation. Create a revision or a variation to change it.");
  for (const layout_settings of [null, {}, { projectFile: {} }, { projectFile: { orderNo: "OR-1" } }, { projectFile: { ...projectFile, total: "1468.95" } }, { clientApprovalDraft: { confirmedOrder: projectFile } }]) {
    assert.equal(isQuotationLocked({ layout_settings }), false);
    assert.equal(quotationLockReason({ layout_settings }), null);
  }
});

test("locked updates allow only operational fields and preserve all commercial layout keys", () => {
  for (const key of ["projectCompletedAt", "projectCancelledAt", "folderArchivedAt"]) {
    const layout_settings = { ...locked.layout_settings, [key]: "now" };
    assert.equal(isLockedQuotationUpdateAllowed(locked, { layout_settings }), true);
    assert.equal(isLockedQuotationUpdateAllowed({ ...locked, layout_settings }, { layout_settings: locked.layout_settings }), true);
  }
  for (const key of ["pricing_rule", "price_rounding", "projectFile", "documentSetup", "unknownFuturePricingKey"]) {
    assert.equal(isLockedQuotationUpdateAllowed(locked, { layout_settings: { ...locked.layout_settings, [key]: null } }), false, key);
  }
  assert.equal(isLockedQuotationUpdateAllowed(locked, { layout_settings: { projectCompletedAt: "now" } }), false);
  for (const patch of [{ title: "Changed" }, { currency: "USD" }, { vat_percent: 10 }, { grand_total: 0 }, { notes: "Changed" }, { client_id: "other" }, { status: "draft" }, { status: "revision_required" }]) {
    assert.equal(isLockedQuotationUpdateAllowed(locked, patch), false);
  }
  assert.equal(isLockedQuotationUpdateAllowed(locked, { status: "cancelled", status_note: "Client cancelled" }), true);
  assert.equal(isLockedQuotationUpdateAllowed(locked, { approved_salesperson_id: "manager" }), true);
  assert.equal(isLockedQuotationUpdateAllowed({ layout_settings: {} }, { title: "Changed" }), true);
});

test("approval lifecycle updates cannot change a frozen confirmed order total", () => {
  const current = { ...locked, layout_settings: { ...locked.layout_settings, clientApprovalDraft: { total: 1468.95, confirmedOrder: { total: 1468.95 }, approvalStatus: "Pending" } } };
  const draft = current.layout_settings.clientApprovalDraft;
  assert.equal(isLockedQuotationUpdateAllowed(current, { layout_settings: { ...current.layout_settings, clientApprovalDraft: { ...draft, approvalStatus: "Cancelled", cancelledAt: "now" } } }), true);
  assert.equal(isLockedQuotationUpdateAllowed(current, { layout_settings: { ...current.layout_settings, clientApprovalDraft: { ...draft, confirmedOrder: { total: 0 } } } }), false);
});

test("copies and revisions are new unlocked quotations while source and pricing rule stay intact", () => {
  const copy = unlockedQuotationCopyLayoutSettings(locked.layout_settings);
  assert.equal(isQuotationLocked({ layout_settings: copy }), false);
  assert.equal(copy.pricing_rule, "whole_aed_v1");
  assert.equal(isQuotationLocked(locked), true);
});

test("a revision, option, duplicate or new-enquiry copy of a locked quotation opens unlocked; the source stays locked", () => {
  const source = locked;
  const copies = [
    lockedSourceCopySettings(source, branchLayoutSettings(source.layout_settings, { kind: "revision" })), // revision and option
    lockedSourceCopySettings(source, source.layout_settings), // plain duplicate
    lockedSourceCopySettings(source, newEnquiryCopyLayoutSettings(source.layout_settings)),
  ] as Array<Record<string, unknown>>;
  for (const copy of copies) {
    assert.equal(isQuotationLocked({ layout_settings: copy }), false);
    assert.equal(copy.pricing_rule, "whole_aed_v1"); // the pricing rule goes with the copy
    assert.equal(isLockedQuotationUpdateAllowed({ layout_settings: copy }, { title: "Changed", layout_settings: { ...copy, pricing_rule: "round_up_5_legacy" } }), true);
  }
  assert.ok(source.layout_settings.projectFile, "the source keeps its Project File");
  assert.equal(isQuotationLocked(source), true);
});

test("an unlocked source is copied exactly as before", () => {
  const settings = { clientApprovalDraft: { approvalStatus: "Pending" }, pricing_rule: "round_up_5_legacy" };
  assert.equal(lockedSourceCopySettings({ layout_settings: settings }, settings), settings);
});

test("a locked quotation can move only to statuses that do not make it editable again", () => {
  for (const status of ["client_confirmed", "on_hold", "cancelled", "archived", "completed"]) assert.equal(isLockedQuotationUpdateAllowed(locked, { status }), true, status);
  for (const status of ["draft", "internal_review", "revision_required", "ready_to_send", "sent_to_client", "unknown", ""]) assert.equal(isLockedQuotationUpdateAllowed(locked, { status }), false, status);
});

test("copyQuotation strips Project metadata through the locked-source helper", async () => {
  const { readFileSync } = await import("node:fs");
  const actions = readFileSync(new URL("../../app/quotations/actions.ts", import.meta.url), "utf8");
  assert.ok(actions.includes("lockedSourceCopySettings(source, "));
  assert.ok(!actions.includes("unlockedQuotationCopyLayoutSettings"));
});
